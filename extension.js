const vscode = require('vscode');

// ============================================================
// IF EXPANDER
// ============================================================

function findMatchingParen(text, openPos) {
    let depth = 0;
    for (let i = openPos; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function tryExpandLine(line) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return line;
    const indent = line.match(/^(\s*)/)[1];
    const ifMatch = /^((?:}\s*)?(?:else\s+)?if\s*)\(/.exec(trimmed);
    if (!ifMatch) return line;
    const parenStart = ifMatch[1].length;
    const parenEnd = findMatchingParen(trimmed, parenStart);
    if (parenEnd === -1) return line;
    const afterCondition = trimmed.slice(parenEnd + 1).trim();
    if (afterCondition.startsWith('{')) return line;
    if (!afterCondition.endsWith(';') || afterCondition.includes('{')) return line;
    const condition = trimmed.slice(0, parenEnd + 1);
    const bodyIndent = indent + '    ';
    return `${indent}${condition} {\n${bodyIndent}${afterCondition}\n${indent}}`;
}

function expandIfBlocks(text) {
    return text.split('\n').map(tryExpandLine).join('\n');
}

async function applyIfTransform(editor) {
    const doc = editor.document;
    const text = doc.getText();
    const transformed = expandIfBlocks(text);
    if (transformed === text) return;
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
    await editor.edit(editBuilder => editBuilder.replace(fullRange, transformed));
}

// ============================================================
// HTML ATTRIBUTES COLLAPSER
// ============================================================

function collapseHtmlAttributes(text) {
    const result = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === '<' && i + 1 < text.length && text[i + 1] !== '!' && text[i + 1] !== '/' && /[a-zA-Z]/.test(text[i + 1])) {
            let j = i + 1;
            let inQuote = null;
            let tagContent = '<';
            let hasNewline = false;
            while (j < text.length) {
                const ch = text[j];
                if (inQuote) {
                    if (ch === inQuote) inQuote = null;
                    tagContent += ch;
                } else if (ch === '"' || ch === "'") {
                    inQuote = ch;
                    tagContent += ch;
                } else if (ch === '>') {
                    tagContent += '>';
                    j++;
                    break;
                } else {
                    if (ch === '\n') hasNewline = true;
                    tagContent += ch;
                }
                j++;
            }
            if (hasNewline) {
                const collapsed = tagContent
                    .replace(/\s*\n\s*/g, ' ')
                    .replace(/\s{2,}/g, ' ')
                    .replace(/\s+>/g, '>')
                    .replace(/\s+\/>/g, ' />');
                result.push(collapsed);
            } else {
                result.push(tagContent);
            }
            i = j;
        } else {
            result.push(text[i]);
            i++;
        }
    }
    return result.join('');
}

// ============================================================
// @isTest COLLAPSER
// ============================================================

async function collapseTestMethods(editor) {
    const lines = editor.document.getText().split('\n');
    const methodLines = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '@isTest' || trimmed.startsWith('@isTest(')) {
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                if (lines[j].trim().length > 0) {
                    methodLines.push(j);
                    break;
                }
            }
        }
    }
    if (methodLines.length === 0) {
        vscode.window.showInformationMessage('SF Tools: No se encontraron métodos @isTest.');
        return;
    }
    await vscode.commands.executeCommand('editor.fold', { selectionLines: methodLines });
    vscode.window.showInformationMessage(`SF Tools: ${methodLines.length} método(s) @isTest colapsados.`);
}

// ============================================================
// CUSTOM LABEL EXTRACTOR
// ============================================================

function toApiName(text) {
    return text
        .trim()
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 80);
}

function getLabelReplacement(apiName, languageId, fileName) {
    if (languageId === 'apex') return `Label.${apiName}`;
    if (fileName.endsWith('.html')) return `{label.${apiName}}`;
    return `{!$Label.c.${apiName}}`;
}

async function addLabelToFile(fileUri, apiName, value) {
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const newLabel = `
    <labels>
        <fullName>${apiName}</fullName>
        <language>es</language>
        <protected>false</protected>
        <shortDescription>${apiName}</shortDescription>
        <value>${escaped}</value>
    </labels>`;

    let content;
    try {
        const existing = await vscode.workspace.fs.readFile(fileUri);
        content = Buffer.from(existing).toString('utf8');
        if (content.includes(`<fullName>${apiName}</fullName>`)) {
            vscode.window.showWarningMessage(`SF Tools: El label '${apiName}' ya existe en CustomLabels.`);
            return false;
        }
        content = content.replace('</CustomLabels>', `${newLabel}\n</CustomLabels>`);
    } catch {
        try { await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..')); } catch {}
        content = `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">${newLabel}
</CustomLabels>`;
    }

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    return true;
}

async function extractToCustomLabel(editor) {
    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('SF Tools: Selecciona el texto a convertir en Custom Label.');
        return;
    }

    const selectedText = editor.document.getText(selection).replace(/^['"]|['"]$/g, '');
    const apiName = toApiName(selectedText);

    if (!apiName) {
        vscode.window.showErrorMessage('SF Tools: No se pudo generar un API name válido.');
        return;
    }

    const confirmedName = await vscode.window.showInputBox({
        prompt: 'Confirma o edita el API name del Custom Label',
        value: apiName,
        validateInput: v => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(v) ? null : 'Solo letras, números y _. Debe empezar por letra.'
    });
    if (!confirmedName) return;

    const doc = editor.document;
    const replacement = getLabelReplacement(confirmedName, doc.languageId, doc.fileName);
    await editor.edit(editBuilder => editBuilder.replace(selection, replacement));

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('SF Tools: Label reemplazado pero no se encontró workspace para crear el XML.');
        return;
    }

    const labelsUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        'force-app', 'main', 'default', 'labels', 'CustomLabels.labels-meta.xml'
    );

    const created = await addLabelToFile(labelsUri, confirmedName, selectedText);
    if (created) {
        const open = await vscode.window.showInformationMessage(
            `SF Tools: Label '${confirmedName}' añadido a CustomLabels.labels-meta.xml`,
            'Abrir XML'
        );
        if (open === 'Abrir XML') {
            const xmlDoc = await vscode.workspace.openTextDocument(labelsUri);
            vscode.window.showTextDocument(xmlDoc);
        }
    }
}

// ============================================================
// ACTIVATE
// ============================================================

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.expandIfs', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            await applyIfTransform(editor);
            vscode.window.showInformationMessage('SF Tools: If blocks expandidos.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.formatAll', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            await applyIfTransform(editor);
            await editor.document.save();
            await vscode.commands.executeCommand('editor.action.formatDocument');
            vscode.window.showInformationMessage('SF Tools: ifs expandidos + documento indentado.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.collapseHtml', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            const text = editor.document.getText();
            const collapsed = collapseHtmlAttributes(text);
            if (collapsed === text) {
                vscode.window.showInformationMessage('SF Tools: No hay tags multilínea que colapsar.');
                return;
            }
            const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
            await editor.edit(editBuilder => editBuilder.replace(fullRange, collapsed));
            vscode.window.showInformationMessage('SF Tools: Atributos HTML colapsados a una línea.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.collapseTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            await collapseTestMethods(editor);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.extractLabel', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;
            await extractToCustomLabel(editor);
        })
    );

    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(async (event) => {
            const config = vscode.workspace.getConfiguration('sf-tools');
            if (!config.get('expandOnSave', true)) return;
            const lang = event.document.languageId;
            if (lang !== 'apex' && lang !== 'javascript') return;
            const editor = vscode.window.visibleTextEditors.find(e => e.document === event.document);
            if (editor) await applyIfTransform(editor);
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
