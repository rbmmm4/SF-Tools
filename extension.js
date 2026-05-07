const vscode = require('vscode');

// ============================================================
// IF EXPANDER
// ============================================================

function findMatchingParen(text, openPos) {
    let depth = 0;
    for (let i = openPos; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') { depth--; if (depth === 0) return i; }
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
// SOQL COLLAPSER (bracket SOQL → single line)
// ============================================================

function collapseSoql(text) {
    const result = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === '[') {
            let depth = 1;
            let j = i + 1;
            let content = '';
            while (j < text.length && depth > 0) {
                if (text[j] === '[') depth++;
                else if (text[j] === ']') { depth--; if (depth === 0) { j++; break; } }
                if (depth > 0) content += text[j];
                j++;
            }
            if (/\bSELECT\b/i.test(content) && content.includes('\n')) {
                const collapsed = content.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
                result.push(`[${collapsed}]`);
            } else {
                result.push(text.slice(i, j));
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
                    tagContent += '>'; j++; break;
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
            result.push(text[i]); i++;
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
                if (lines[j].trim().length > 0) { methodLines.push(j); break; }
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
    return text.trim()
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
            vscode.window.showWarningMessage(`SF Tools: El label '${apiName}' ya existe.`);
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
    if (!apiName) { vscode.window.showErrorMessage('SF Tools: No se pudo generar un API name válido.'); return; }

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
    const labelsUri = vscode.Uri.joinPath(workspaceFolder.uri, 'force-app', 'main', 'default', 'labels', 'CustomLabels.labels-meta.xml');
    const created = await addLabelToFile(labelsUri, confirmedName, selectedText);
    if (created) {
        const open = await vscode.window.showInformationMessage(
            `SF Tools: Label '${confirmedName}' añadido a CustomLabels.labels-meta.xml`, 'Abrir XML'
        );
        if (open === 'Abrir XML') vscode.window.showTextDocument(await vscode.workspace.openTextDocument(labelsUri));
    }
}

// ============================================================
// MÉTRICAS DE COMPLEJIDAD
// ============================================================

// Decoraciones método-nivel (CC, COG, LOC, Params)
const ccLow  = vscode.window.createTextEditorDecorationType({ after: { color: '#4CAF50', fontStyle: 'italic', margin: '0 0 0 3em' } });
const ccMed  = vscode.window.createTextEditorDecorationType({ after: { color: '#FFA726', fontStyle: 'italic', margin: '0 0 0 3em' } });
const ccHigh = vscode.window.createTextEditorDecorationType({ after: { color: '#EF5350', fontStyle: 'italic', margin: '0 0 0 3em' } });

// Decoraciones línea-nivel (nesting depth por if/for/while)
const depLow  = vscode.window.createTextEditorDecorationType({ after: { color: '#4CAF50', fontStyle: 'italic', margin: '0 0 0 2em' } });
const depMed  = vscode.window.createTextEditorDecorationType({ after: { color: '#FFA726', fontStyle: 'italic', margin: '0 0 0 2em' } });
const depHigh = vscode.window.createTextEditorDecorationType({ after: { color: '#EF5350', fontStyle: 'italic', margin: '0 0 0 2em' } });

// Ciclomática: cuenta puntos de decisión
function calculateComplexity(bodyText) {
    let score = 1;
    const patterns = [
        /\bif\s*\(/g, /\belse\s+if\s*\(/g, /\bfor\s*\(/g,
        /\bwhile\s*\(/g, /\bcase\b/g, /\bcatch\s*\(/g,
        /&&/g, /\|\|/g, /\?[^?:]/g
    ];
    for (const p of patterns) { const m = bodyText.match(p); if (m) score += m.length; }
    return score;
}

// Cognitiva: igual que ciclomática pero penaliza el anidamiento
function calculateCognitive(bodyLines) {
    let score = 0;
    let nesting = 0;
    for (const line of bodyLines) {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('*')) {
            const o = (t.match(/{/g) || []).length;
            const c = (t.match(/}/g) || []).length;
            nesting = Math.max(0, nesting + o - c);
            continue;
        }
        if (/\bif\s*\(/.test(t))             score += 1 + nesting;
        if (/\belse\s+if\s*\(/.test(t))      score += 1 + nesting;
        else if (/\belse\b/.test(t) && !/\bif\b/.test(t)) score += 1;
        if (/\bfor\s*\(/.test(t))            score += 1 + nesting;
        if (/\bwhile\s*\(/.test(t))          score += 1 + nesting;
        if (/\bcatch\s*\(/.test(t))          score += 1;
        const bops = (t.match(/&&|\|\|/g) || []).length;
        score += bops;
        const o = (t.match(/{/g) || []).length;
        const c = (t.match(/}/g) || []).length;
        nesting = Math.max(0, nesting + o - c);
    }
    return score;
}

// Profundidad máxima de anidamiento
function maxNesting(bodyLines) {
    let depth = 0, max = 0;
    for (const line of bodyLines) {
        for (const ch of line) {
            if (ch === '{') { depth++; if (depth > max) max = depth; }
            else if (ch === '}') depth--;
        }
    }
    return Math.max(0, max - 1); // -1 por las llaves del propio método
}

// Número de parámetros
function countParams(signatureLine) {
    const start = signatureLine.indexOf('(');
    if (start === -1) return 0;
    const end = findMatchingParen(signatureLine, start);
    if (end === -1) return 0;
    const inner = signatureLine.slice(start + 1, end).trim();
    if (!inner) return 0;
    let count = 1, depth = 0;
    for (const ch of inner) {
        if (ch === '<' || ch === '(') depth++;
        else if (ch === '>' || ch === ')') depth--;
        else if (ch === ',' && depth === 0) count++;
    }
    return count;
}

function findApexMethods(document) {
    const lines = document.getText().split('\n');
    const results = [];
    const methodRe = /^\s*(?:(?:public|private|protected|global|override|static|virtual|abstract|testMethod)\s+)*(void|Boolean|Integer|Long|Double|Decimal|String|Id|Date|DateTime|Datetime|Blob|List|Map|Set|[A-Z][a-zA-Z0-9_<>, ]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = methodRe.exec(line);
        if (!m || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        let braceStart = -1;
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (lines[j].includes('{')) { braceStart = j; break; }
            if (lines[j].trim().endsWith(';')) break;
        }
        if (braceStart === -1) continue;

        let depth = 0, bodyLines = [], started = false;
        for (let j = braceStart; j < lines.length; j++) {
            for (const ch of lines[j]) {
                if (ch === '{') { depth++; started = true; }
                else if (ch === '}') depth--;
            }
            if (started) bodyLines.push(lines[j]);
            if (started && depth === 0) break;
        }

        const bodyText = bodyLines.join('\n');
        const loc = bodyLines.filter(l => l.trim() && !l.trim().startsWith('//')).length;

        results.push({
            line: i,
            name: m[2],
            cc:       calculateComplexity(bodyText),
            cog:      calculateCognitive(bodyLines),
            loc,
            params:   countParams(line),
            depth:    maxNesting(bodyLines)
        });
    }
    return results;
}

function updateComplexityDecorations(editor) {
    if (!editor) return;
    const config = vscode.workspace.getConfiguration('sf-tools');
    const showAll = config.get('showComplexity', true);

    if (!showAll || editor.document.languageId !== 'apex') {
        editor.setDecorations(ccLow, []);
        editor.setDecorations(ccMed, []);
        editor.setDecorations(ccHigh, []);
        editor.setDecorations(depLow, []);
        editor.setDecorations(depMed, []);
        editor.setDecorations(depHigh, []);
        return;
    }

    const show = config.get('complexity') || {};

    // --- Métricas a nivel de método (CC, COG, LOC, Params) ---
    const methods = findApexMethods(editor.document);
    const low = [], med = [], high = [];

    for (const m of methods) {
        const parts = [];
        if (show.cyclomatic !== false) parts.push(`CC:${m.cc}`);
        if (show.cognitive)            parts.push(`COG:${m.cog}`);
        if (show.loc)                  parts.push(`LOC:${m.loc}`);
        if (show.params)               parts.push(`Params:${m.params}`);
        if (parts.length === 0) continue;

        const range = new vscode.Range(m.line, 0, m.line, 1000);
        const opt = { range, renderOptions: { after: { contentText: `  ${parts.join(' · ')}` } } };
        if (m.cc <= 5)       low.push(opt);
        else if (m.cc <= 10) med.push(opt);
        else                 high.push(opt);
    }

    editor.setDecorations(ccLow, low);
    editor.setDecorations(ccMed, med);
    editor.setDecorations(ccHigh, high);

    // --- Profundidad de anidamiento por línea (nesting) ---
    if (!show.nesting) {
        editor.setDecorations(depLow, []);
        editor.setDecorations(depMed, []);
        editor.setDecorations(depHigh, []);
        return;
    }

    const lines = editor.document.getText().split('\n');
    const dLow = [], dMed = [], dHigh = [];
    const methodRe = /^\s*(?:(?:public|private|protected|global|override|static|virtual|abstract|testMethod)\s+)*(void|Boolean|Integer|Long|Double|Decimal|String|Id|Date|DateTime|Datetime|Blob|List|Map|Set|[A-Z][a-zA-Z0-9_<>, ]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
    const controlRe = /^\s*(?:(?:}\s*)?else\s+if|if|for|while|else|try|catch)\b/;

    let depth = 0;
    let inMethod = false;
    let methodDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        let opens = 0, closes = 0, inStr = false, sc = null;

        for (const ch of line) {
            if (inStr) { if (ch === sc) inStr = false; }
            else if (ch === '"' || ch === "'") { inStr = true; sc = ch; }
            else if (ch === '{') opens++;
            else if (ch === '}') closes++;
        }

        if (!t.startsWith('//') && methodRe.test(line) && opens > 0) {
            inMethod = true;
            methodDepth = depth + opens;
        }

        if (inMethod && opens > 0 && controlRe.test(t) && !t.startsWith('//')) {
            const relDepth = depth + opens - methodDepth;
            if (relDepth >= 0) {
                const range = new vscode.Range(i, 0, i, 1000);
                const opt = { range, renderOptions: { after: { contentText: `  nesting:${relDepth}` } } };
                if (relDepth <= 1)      dLow.push(opt);
                else if (relDepth <= 3) dMed.push(opt);
                else                    dHigh.push(opt);
            }
        }

        depth = Math.max(0, depth + opens - closes);
        if (inMethod && depth < methodDepth) inMethod = false;
    }

    editor.setDecorations(depLow, dLow);
    editor.setDecorations(depMed, dMed);
    editor.setDecorations(depHigh, dHigh);
}

// ============================================================
// ACTIVATE
// ============================================================

function activate(context) {

    // Expand if blocks
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.expandIfs', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        await applyIfTransform(editor);
        vscode.window.showInformationMessage('SF Tools: If blocks expandidos.');
    }));

    // Format All — comando maestro configurable desde Settings
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.formatAll', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        const cfg = vscode.workspace.getConfiguration('sf-tools').get('runAll');
        const lang = editor.document.languageId;
        const steps = [];

        if (cfg.expandIfs && (lang === 'apex' || lang === 'javascript')) {
            steps.push('Expandiendo ifs...');
            await applyIfTransform(editor);
        }
        if (cfg.collapseSoql && lang === 'apex') {
            steps.push('Colapsando SOQL...');
            const text = editor.document.getText();
            const collapsed = collapseSoql(text);
            if (collapsed !== text) {
                const r = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
                await editor.edit(eb => eb.replace(r, collapsed));
            }
        }
        if (cfg.collapseHtml && (lang === 'html' || lang === 'visualforce')) {
            steps.push('Colapsando HTML...');
            const text = editor.document.getText();
            const collapsed = collapseHtmlAttributes(text);
            if (collapsed !== text) {
                const r = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
                await editor.edit(eb => eb.replace(r, collapsed));
            }
        }
        if (cfg.collapseTests && lang === 'apex') {
            steps.push('Colapsando @isTest...');
            await collapseTestMethods(editor);
        }
        if (cfg.formatDocument) {
            steps.push('Indentando documento...');
            await editor.document.save();
            await vscode.commands.executeCommand('editor.action.formatDocument');
        }

        if (steps.length === 0) {
            vscode.window.showWarningMessage('SF Tools: Run All no tiene ninguna operación activa. Revisa Settings → SF Tools → Run All.');
        } else {
            vscode.window.showInformationMessage(`SF Tools: Run All completado (${steps.length} operación(es)).`);
        }
    }));

    // SOQL collapser
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.collapseSoql', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        const text = editor.document.getText();
        const collapsed = collapseSoql(text);
        if (collapsed === text) { vscode.window.showInformationMessage('SF Tools: No se encontró SOQL multilínea.'); return; }
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        await editor.edit(eb => eb.replace(fullRange, collapsed));
        vscode.window.showInformationMessage('SF Tools: SOQL queries colapsadas a una línea.');
    }));

    // HTML collapser
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.collapseHtml', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        const text = editor.document.getText();
        const collapsed = collapseHtmlAttributes(text);
        if (collapsed === text) { vscode.window.showInformationMessage('SF Tools: No hay tags multilínea.'); return; }
        const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
        await editor.edit(eb => eb.replace(fullRange, collapsed));
        vscode.window.showInformationMessage('SF Tools: Atributos HTML colapsados a una línea.');
    }));

    // @isTest collapser
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.collapseTests', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        await collapseTestMethods(editor);
    }));

    // Extract to Custom Label
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.extractLabel', async () => {
        const editor = vscode.window.activeTextEditor; if (!editor) return;
        await extractToCustomLabel(editor);
    }));

    // Toggle complexity visibility
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.toggleComplexity', async () => {
        const config = vscode.workspace.getConfiguration('sf-tools');
        const current = config.get('showComplexity', true);
        await config.update('showComplexity', !current, vscode.ConfigurationTarget.Global);
        const editor = vscode.window.activeTextEditor;
        if (editor) updateComplexityDecorations(editor);
        vscode.window.showInformationMessage(`SF Tools: Complejidad ${!current ? 'activada' : 'desactivada'}.`);
    }));

    // Auto expand on save
    context.subscriptions.push(vscode.workspace.onWillSaveTextDocument(async (event) => {
        const config = vscode.workspace.getConfiguration('sf-tools');
        if (!config.get('expandOnSave', true)) return;
        const lang = event.document.languageId;
        if (lang !== 'apex' && lang !== 'javascript') return;
        const editor = vscode.window.visibleTextEditors.find(e => e.document === event.document);
        if (editor) await applyIfTransform(editor);
    }));

    // Complexity: update on editor change and document edit
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => updateComplexityDecorations(editor)));

    let debounceTimer;
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => updateComplexityDecorations(editor), 800);
    }));

    // Initial render
    if (vscode.window.activeTextEditor) updateComplexityDecorations(vscode.window.activeTextEditor);
}

function deactivate() {}

module.exports = { activate, deactivate };
