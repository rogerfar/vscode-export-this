import { posix } from 'path';
import * as vscode from 'vscode';

const COMMAND = 'export-this.command';

const EXPORT_THIS_MENTION = 'export_this_mention';

const EXPORT = 'export';

export function activate(context: vscode.ExtensionContext) {
    const exportThisDiagnostics = vscode.languages.createDiagnosticCollection(
        'export_this'
    );
    context.subscriptions.push(exportThisDiagnostics);

    subscribeToDocumentChanges(context, exportThisDiagnostics);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            'typescript',
            new ExportThisInfo(),
            {
                providedCodeActionKinds: ExportThisInfo.providedCodeActionKinds,
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMAND, async () => {
            // Check if a workspace is loaded, if not, exit early.
            const wss = vscode.workspace.workspaceFolders;

            if (!wss || !wss[0]) {
                vscode.window.showErrorMessage(`No folder/workspace open.`);
                return;
            }

            const workspaceUri = wss[0].uri;

            const filePath = vscode.window.activeTextEditor?.document.uri;

            if (!filePath) {
                vscode.window.showErrorMessage(`Error loading active file.`);
                return;
            }

            // Check the current folder first.
            let indexPath = posix.join(filePath.path, '..', 'index.ts');

            let indexUri = vscode.Uri.file(indexPath);

            if (!indexUri) {
                vscode.window.showErrorMessage(
                    `Error constructing index.ts file path.`
                );
                return;
            }

            // Go down 1 folder each time and check for an index.ts file.
            let found: boolean = false;

            // Failsafe.
            let iteration: number = 0;

            while (!found && iteration < 100) {
                indexUri = indexUri.with({ path: indexPath });

                try {
                    await vscode.workspace.fs.stat(indexUri);
                    found = true;
                } catch {
                    // Go down 1 folder.
                    indexPath = posix.join(
                        indexUri.path,
                        '..',
                        '..',
                        'index.ts'
                    );

                    if (indexPath.indexOf(workspaceUri.path) === -1) {
                        break;
                    }

                    iteration++;
                }
            }

            // If no index.ts was found, show an error and exit.
            if (!found) {
                vscode.window.showErrorMessage(
                    'Unable to find an index.ts file to export to'
                );
                return;
            }

            // Add the export text to the end of the file.
            const fileDir = posix.dirname(filePath.path);
            const fileName = posix.basename(filePath.path, '.ts');
            const indexDir = posix.dirname(indexUri.path);
            const relativePath = fileDir.replace(indexDir, '');

            const exportText = `export * from '.${relativePath}/${fileName}';`;

            vscode.workspace.openTextDocument(indexUri).then(
                (textDocument: vscode.TextDocument) => {
                    vscode.window
                        .showTextDocument(textDocument, 1, false)
                        .then((e) => {
                            e.edit((edit) => {
                                edit.insert(
                                    new vscode.Position(
                                        textDocument.lineCount,
                                        0
                                    ),
                                    exportText
                                );
                            });
                        });
                },
                (error: any) => {
                    console.error(error);
                    vscode.window.showErrorMessage(
                        `Error inserting export snippet.`
                    );
                }
            );
        })
    );
}

export class ExportThisInfo implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        return context.diagnostics
            .filter((diagnostic) => diagnostic.code === EXPORT_THIS_MENTION)
            .map((diagnostic) => this.createCommandCodeAction(diagnostic));
    }

    private createCommandCodeAction(
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Export file',
            vscode.CodeActionKind.QuickFix
        );
        action.command = {
            command: COMMAND,
            title: 'Export file',
            tooltip:
                'This will export the current file to the nearst index.ts file.',
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = false;
        return action;
    }
}

export function refreshDiagnostics(
    doc: vscode.TextDocument,
    diagnosticsCollection: vscode.DiagnosticCollection
): void {
    const diagnostics: vscode.Diagnostic[] = [];

    for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
        const lineOfText = doc.lineAt(lineIndex);
        if (lineOfText.text.includes(EXPORT)) {
            diagnostics.push(createDiagnostic(doc, lineOfText, lineIndex));
        }
    }

    diagnosticsCollection.set(doc.uri, diagnostics);
}

function createDiagnostic(
    doc: vscode.TextDocument,
    lineOfText: vscode.TextLine,
    lineIndex: number
): vscode.Diagnostic {
    // find where in the line of thet the 'export' is mentioned
    const index = lineOfText.text.indexOf(EXPORT);

    // create range that represents, where in the document the word is
    const range = new vscode.Range(
        lineIndex,
        index,
        lineIndex,
        index + EXPORT.length
    );

    const diagnostic = new vscode.Diagnostic(
        range,
        'Export file',
        vscode.DiagnosticSeverity.Hint
    );
    diagnostic.code = EXPORT_THIS_MENTION;
    return diagnostic;
}

export function subscribeToDocumentChanges(
    context: vscode.ExtensionContext,
    emojiDiagnostics: vscode.DiagnosticCollection
): void {
    if (vscode.window.activeTextEditor) {
        refreshDiagnostics(
            vscode.window.activeTextEditor.document,
            emojiDiagnostics
        );
    }
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                refreshDiagnostics(editor.document, emojiDiagnostics);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) =>
            refreshDiagnostics(e.document, emojiDiagnostics)
        )
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) =>
            emojiDiagnostics.delete(doc.uri)
        )
    );
}
