import { posix } from 'path';
import * as vscode from 'vscode';

const COMMAND = 'export-this.command';

const EXPORT_THIS_MENTION = 'export_this_mention';

const EXPORT = 'export';

export async function activate(context: vscode.ExtensionContext) {
    const exportThisDiagnostics = vscode.languages.createDiagnosticCollection('export_this');
    context.subscriptions.push(exportThisDiagnostics);

    await subscribeToDocumentChanges(context, exportThisDiagnostics);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('typescript', new ExportThisInfo(), {
            providedCodeActionKinds: ExportThisInfo.providedCodeActionKinds,
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMAND, async () => {
            const indexUri = await findIndex();

            // If no index.ts was found, show an error and exit.
            if (!indexUri) {
                vscode.window.showErrorMessage('Unable to find an index.ts file to export to');
                return;
            }

            // Add the export text to the end of the file.
            const relPath = getRelativePath(indexUri);

            if (relPath == null) {
                vscode.window.showErrorMessage('Unable to construct the relative path');
                return;
            }

            const exportText = `export * from '.${relPath}';`;

            const textDocument = await vscode.workspace.openTextDocument(indexUri);

            try {
                const e = await vscode.window.showTextDocument(textDocument, 1, false);

                e.edit((edit) => {
                    edit.insert(new vscode.Position(textDocument.lineCount, 0), exportText);
                });
            } catch (error) {
                console.error(error);
                vscode.window.showErrorMessage(`Error inserting export snippet.`);
            }
        })
    );
}

export class ExportThisInfo implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

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

    private createCommandCodeAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
        const action = new vscode.CodeAction('Export file', vscode.CodeActionKind.QuickFix);
        action.command = {
            command: COMMAND,
            title: 'Export file',
            tooltip: 'This will export the current file to the nearst index.ts file.',
        };
        action.diagnostics = [diagnostic];
        action.isPreferred = false;
        return action;
    }
}

async function refreshDiagnostics(
    doc: vscode.TextDocument,
    diagnosticsCollection: vscode.DiagnosticCollection
): Promise<void> {
    const fileUri = vscode.Uri.file(doc.fileName);

    const fileName = posix.basename(fileUri.path);
    if (fileName === 'index.ts') {
        return;
    }

    let diagnostics: vscode.Diagnostic[] = [];

    for (let lineIndex = 0; lineIndex < doc.lineCount; lineIndex++) {
        const lineOfText = doc.lineAt(lineIndex);
        if (lineOfText.text.includes(EXPORT)) {
            // Find where in the line of the word 'export' is mentioned.
            const index = lineOfText.text.indexOf(EXPORT);

            // Check if this declaration has already been exported
            const indexUri = await findIndex();

            // If no index.ts can be found at all, don't even highlight.
            if (indexUri == null) {
                return;
            }

            const relPath = getRelativePath(indexUri);

            if (relPath == null) {
                return;
            }

            const textDocument = await vscode.workspace.openTextDocument(indexUri);

            const text = textDocument.getText();

            if (text.indexOf(relPath) === -1) {
                // Create range that represents, where in the document the word is
                const range = new vscode.Range(lineIndex, index, lineIndex, index + EXPORT.length);

                const diagnostic = new vscode.Diagnostic(
                    range,
                    'Export file',
                    vscode.DiagnosticSeverity.Hint
                );
                diagnostic.code = EXPORT_THIS_MENTION;

                diagnostics.push(diagnostic);
            }
        }
    }

    diagnosticsCollection.set(doc.uri, diagnostics);
}

async function subscribeToDocumentChanges(
    context: vscode.ExtensionContext,
    diagnosticCollection: vscode.DiagnosticCollection
): Promise<void> {
    if (vscode.window.activeTextEditor) {
        await refreshDiagnostics(vscode.window.activeTextEditor.document, diagnosticCollection);
    }
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor) {
                await refreshDiagnostics(editor.document, diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(
            async (editor) => await refreshDiagnostics(editor.document, diagnosticCollection)
        )
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => diagnosticCollection.delete(doc.uri))
    );
}

async function findIndex(): Promise<vscode.Uri | null | undefined> {
    // Check if a workspace is loaded, if not, exit early.
    const wss = vscode.workspace.workspaceFolders;

    if (!wss || !wss[0]) {
        vscode.window.showErrorMessage(`No folder/workspace open.`);
        return null;
    }

    const workspaceUri = wss[0].uri;

    const filePath = vscode.window.activeTextEditor?.document.uri;

    if (!filePath) {
        vscode.window.showErrorMessage(`Error loading active file.`);
        return null;
    }

    // Check the current folder first.
    let indexPath = posix.join(filePath.path, '..', 'index.ts');

    let indexUri = vscode.Uri.file(indexPath);

    if (!indexUri) {
        vscode.window.showErrorMessage(`Error constructing index.ts file path.`);
        return null;
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
            indexPath = posix.join(indexUri.path, '..', '..', 'index.ts');

            if (indexPath.indexOf(workspaceUri.path) === -1) {
                break;
            }

            iteration++;
        }
    }

    return indexUri;
}

function getRelativePath(indexUri: vscode.Uri): string | null {
    const filePath = vscode.window.activeTextEditor?.document.uri;

    if (!filePath) {
        return null;
    }

    const fileDir = posix.dirname(filePath.path);
    const fileName = posix.basename(filePath.path, '.ts');
    const indexDir = posix.dirname(indexUri.path);
    const relativePath = fileDir.replace(indexDir, '');

    return `${relativePath}/${fileName}`;
}
