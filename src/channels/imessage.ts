/**
 * iMessage channel — uses the `imsg` CLI tool to send/receive iMessages.
 *
 * JID format: imessage:<identifier>
 * where <identifier> is a phone number (e.g. +15551234567) or email.
 *
 * Requires `imsg` on PATH and Full Disk Access granted to the terminal /
 * the process running NanoClaw so it can read ~/Library/Messages/chat.db.
 */
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';

import { logger } from '../logger.js';
import { Channel, NewMessage } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';

const PREFIX = 'imessage:';

export class IMessageChannel implements Channel {
  name = 'imessage';

  private watchProcess: ChildProcess | null = null;
  private connected = false;
  // chat rowid -> identifier (phone/email)
  private chatIdToIdentifier = new Map<number, string>();

  private onMessage: ChannelOpts['onMessage'];
  private onChatMetadata: ChannelOpts['onChatMetadata'];

  constructor(opts: ChannelOpts) {
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
  }

  async connect(): Promise<void> {
    await this.loadChats();
    this.startWatch();
    this.connected = true;
    logger.info('iMessage channel connected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(PREFIX);
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const identifier = jid.slice(PREFIX.length);
    return new Promise((resolve, reject) => {
      const proc = spawn('imsg', ['send', '--to', identifier, '--text', text]);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`imsg send exited with code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.watchProcess) {
      this.watchProcess.kill();
      this.watchProcess = null;
    }
  }

  private async loadChats(): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn('imsg', ['chats', '--json']);
      const rl = createInterface({ input: proc.stdout });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const chat = JSON.parse(line);
          if (chat.identifier && chat.id != null) {
            this.chatIdToIdentifier.set(chat.id, chat.identifier);
            const jid = `${PREFIX}${chat.identifier}`;
            this.onChatMetadata(
              jid,
              chat.last_message_at || new Date().toISOString(),
              chat.name || chat.identifier,
              'imessage',
              false,
            );
          }
        } catch {
          // ignore malformed lines
        }
      });

      proc.on('close', () => resolve());
      proc.on('error', (err) => {
        logger.warn({ err }, 'imsg chats failed');
        resolve();
      });
    });
  }

  private startWatch(): void {
    const proc = spawn('imsg', ['watch', '--json']);
    this.watchProcess = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        this.handleIncoming(msg);
      } catch {
        // ignore malformed lines
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      logger.debug({ data: data.toString().trim() }, 'imsg watch stderr');
    });

    proc.on('close', (code) => {
      if (this.connected) {
        logger.warn({ code }, 'imsg watch exited, restarting in 2s');
        setTimeout(() => this.startWatch(), 2000);
      }
    });

    proc.on('error', (err) => {
      logger.error({ err }, 'imsg watch process error');
    });
  }

  private handleIncoming(msg: any): void {
    // Skip our own outgoing messages
    if (msg.is_from_me) return;
    if (!msg.text) return;

    // Resolve identifier from chat_id map, fall back to sender field
    let identifier: string | undefined;
    if (msg.chat_id != null) {
      identifier = this.chatIdToIdentifier.get(msg.chat_id);
    }
    if (!identifier) {
      identifier = msg.sender;
    }
    if (!identifier) {
      logger.warn({ msg }, 'iMessage: could not determine chat identifier');
      return;
    }

    // Keep the map fresh for new chats
    if (msg.chat_id != null && !this.chatIdToIdentifier.has(msg.chat_id)) {
      this.chatIdToIdentifier.set(msg.chat_id, identifier);
    }

    const jid = `${PREFIX}${identifier}`;
    const timestamp = msg.created_at || new Date().toISOString();

    this.onChatMetadata(jid, timestamp, identifier, 'imessage', false);

    const newMsg: NewMessage = {
      id: String(msg.id ?? msg.guid ?? Date.now()),
      chat_jid: jid,
      sender: identifier,
      sender_name: identifier,
      content: msg.text,
      timestamp,
      is_from_me: false,
    };

    this.onMessage(jid, newMsg);
  }
}

function factory(opts: ChannelOpts): IMessageChannel | null {
  return new IMessageChannel(opts);
}

registerChannel('imessage', factory);
