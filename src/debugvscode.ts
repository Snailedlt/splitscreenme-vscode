// VS Code's Run and Debug for handlers: the inline adapter around src/dap.ts, and F5 on a handler without a launch.json.
import * as vscode from 'vscode';
import { HandlerDebugSession } from './dap';

class InlineAdapter implements vscode.DebugAdapter {
  private readonly emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this.emitter.event;
  private readonly session = new HandlerDebugSession((m) => this.emitter.fire(m as vscode.DebugProtocolMessage));
  handleMessage(m: vscode.DebugProtocolMessage) {
    this.session.handle(m as any);
  }
  dispose() {
    this.emitter.dispose();
  }
}

export function registerDebugger(context: vscode.ExtensionContext, isHandler: (d: vscode.TextDocument) => boolean) {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('nucleus', { createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new InlineAdapter()) }),
    vscode.debug.registerDebugConfigurationProvider('nucleus', {
      // F5 with no launch.json, in a handler: step through it with Try it's defaults.
      resolveDebugConfiguration(_folder, config) {
        if (!config.type && !config.request) {
          const doc = vscode.window.activeTextEditor?.document;
          if (!doc || !isHandler(doc)) return config;
          return { type: 'nucleus', request: 'launch', name: 'Step through the handler', program: '${file}' };
        }
        if (!config.program) config.program = '${file}';
        return config;
      },
      // An open handler with unsaved changes is debugged as it is in the editor.
      resolveDebugConfigurationWithSubstitutedVariables(_folder, config) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === config.program);
        if (doc?.isDirty) config.source = doc.getText();
        return config;
      },
    }),
  );
}
