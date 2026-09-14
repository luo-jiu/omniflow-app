import { ContributionRegistry, isNamespacedContributionId } from './contribution-registry';

export interface HostCommand<Context> {
  readonly id: string;
  readonly title: string;
  readonly argumentSchema: 'none' | 'id';
  readonly exposure: 'host-only';
  readonly isEnabled: (context: Context, argument?: string) => boolean;
  readonly run: (context: Context, argument?: string) => void | Promise<void>;
}
export class HostCommandRegistry<Context> extends ContributionRegistry<HostCommand<Context>> {
  constructor() {
    super((command, owner) => {
      if (!isNamespacedContributionId(command.id) || !command.id.startsWith(`${owner}.`)
        || !command.title.trim() || command.title.length > 128 || !['none', 'id'].includes(command.argumentSchema)
        || command.exposure !== 'host-only' || typeof command.run !== 'function' || typeof command.isEnabled !== 'function') throw new Error('Invalid host command');
    });
  }
  executeHost(id: string, args: unknown, context: Context): void | Promise<void> {
    const command = this.get(id);
    if (!command) throw new Error(`Command unavailable: ${id}`);
    if (command.argumentSchema === 'none' && args !== undefined) throw new Error('This command does not accept arguments');
    if (command.argumentSchema === 'id' && (typeof args !== 'string' || args.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(args))) throw new Error('Invalid command identifier argument');
    const argument = args as string | undefined;
    if (!command.isEnabled(context, argument)) throw new Error(`Command disabled: ${id}`);
    return command.run(context, argument);
  }
}
