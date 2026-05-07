const vscode = require('vscode');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

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

function toConstName(apiName) {
    return apiName.toUpperCase();
}

function toCamelCase(apiName) {
    return apiName
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        .replace(/^[A-Z]/, c => c.toLowerCase());
}

function isLwc(fileName) {
    return fileName.includes('lwc');
}

function isAura(fileName) {
    return fileName.includes('aura');
}

function getLabelReplacement(apiName, languageId, fileName) {
    if (languageId === 'apex') return `Label.${apiName}`;
    if (languageId === 'javascript' && isLwc(fileName)) return toConstName(apiName);
    if (fileName.endsWith('.html') && isLwc(fileName)) return `{${toCamelCase(apiName)}}`;
    return `{!$Label.c.${apiName}}`; // Visualforce / Aura
}

async function addLwcLabelImport(jsFileUri, apiName, constName) {
    let text;
    try {
        const raw = await vscode.workspace.fs.readFile(jsFileUri);
        text = Buffer.from(raw).toString('utf8');
    } catch { return false; }

    if (text.includes(`from '@salesforce/label/c.${apiName}'`)) return true;

    const importLine = `import ${constName} from '@salesforce/label/c.${apiName}';\n`;
    const lines = text.split('\n');

    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) lastImport = i;
    }

    const insertPos = new vscode.Position(Math.max(0, lastImport + 1), 0);
    const jsDoc = await vscode.workspace.openTextDocument(jsFileUri);
    const jsEditor = await vscode.window.showTextDocument(jsDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    await jsEditor.edit(eb => eb.insert(insertPos, importLine));
    return true;
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
    const lang = doc.languageId;
    const fileName = doc.fileName;

    // 1. Reemplazar el texto seleccionado
    const replacement = getLabelReplacement(confirmedName, lang, fileName);
    await editor.edit(eb => eb.replace(selection, replacement));

    // 2. Para LWC JS: añadir import automáticamente al principio del archivo
    if (lang === 'javascript' && isLwc(fileName)) {
        const constName = toConstName(confirmedName);
        await addLwcLabelImport(doc.uri, confirmedName, constName);
    }

    // 3. Para LWC HTML: buscar el JS hermano y añadirle el import + aviso de property
    if (fileName.endsWith('.html') && isLwc(fileName)) {
        const jsPath = fileName.replace(/\.html$/, '.js');
        const jsUri = vscode.Uri.file(jsPath);
        const constName = toConstName(confirmedName);
        const propName = toCamelCase(confirmedName);
        const imported = await addLwcLabelImport(jsUri, confirmedName, constName);
        if (imported) {
            vscode.window.showWarningMessage(
                `SF Tools: Import añadido al JS. Añade en tu clase: ${propName} = ${constName};`
            );
        }
    }

    // 4. Crear/actualizar el XML de Custom Labels
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('SF Tools: Label reemplazado pero no se encontró workspace para crear el XML.');
        return;
    }
    const labelsUri = vscode.Uri.joinPath(
        workspaceFolder.uri, 'force-app', 'main', 'default', 'labels', 'CustomLabels.labels-meta.xml'
    );
    const created = await addLabelToFile(labelsUri, confirmedName, selectedText);
    if (!created) return;

    // 5. Abrir el XML automáticamente al lado del editor actual
    const xmlDoc = await vscode.workspace.openTextDocument(labelsUri);
    await vscode.window.showTextDocument(xmlDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });

    // 6. Preguntar si hacer deploy
    const answer = await vscode.window.showInformationMessage(
        `SF Tools: Label '${confirmedName}' listo. ¿Hacer deploy ahora?`,
        'Sí, deploy',
        'No'
    );
    if (answer === 'Sí, deploy') {
        const terminal = vscode.window.createTerminal('SF Tools — Deploy Label');
        terminal.show();
        terminal.sendText(
            `sf project deploy start --source-dir "force-app/main/default/labels/CustomLabels.labels-meta.xml"`
        );
    }
}

// ============================================================
// NAVEGACIÓN — Go to Definition (Ctrl+Click)
// ============================================================

const APEX_KEYWORDS = new Set([
    'if','else','for','while','do','return','void','null','true','false','this','super','new',
    'class','interface','enum','extends','implements','try','catch','finally','throw',
    'public','private','protected','global','static','final','override','virtual','abstract',
    'with','without','sharing','transient','webservice','testMethod','trigger','on',
    'insert','update','delete','upsert','merge','undelete',
    'String','Integer','Boolean','Decimal','Double','Long','Date','DateTime','Time','Id','Blob','Object',
    'List','Map','Set','SObject','Database','System','Math','Schema','UserInfo',
    'select','from','where','limit','offset','order','by','asc','desc','and','or','not','like','in',
    'group','having','count','sum','avg','min','max'
]);

async function findMethodPosition(fileUri, methodName) {
    try {
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const lines = doc.getText().split('\n');
        const re = new RegExp(`\\b${methodName}\\s*\\(`);
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (re.test(t) && !t.startsWith('//') && !t.startsWith('*')) {
                return new vscode.Position(i, lines[i].indexOf(methodName));
            }
        }
    } catch {}
    return new vscode.Position(0, 0);
}

async function findClassFile(className) {
    const files = await vscode.workspace.findFiles(`**/${className}.cls`, '**/node_modules/**', 1);
    return files.length > 0 ? files[0] : null;
}

function registerNavigationProviders(context) {

    // Provider 1: LWC JS — @salesforce/apex/ClassName.method
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'javascript', pattern: '**/lwc/**/*.js' },
            {
                async provideDefinition(document, position) {
                    const config = vscode.workspace.getConfiguration('sf-tools');
                    if (!config.get('enableNavigation', true)) return null;

                    const line = document.lineAt(position).text;
                    if (!line.includes('@salesforce/apex/')) return null;

                    const match = /@salesforce\/apex\/([\w]+)\.([\w]+)/.exec(line);
                    if (!match) return null;

                    const [, className, methodName] = match;
                    const wordRange = document.getWordRangeAtPosition(position, /\w+/);
                    if (!wordRange) return null;
                    const word = document.getText(wordRange);
                    if (word !== className && word !== methodName) return null;

                    const file = await findClassFile(className);
                    if (!file) return null;

                    const targetPos = word === methodName
                        ? await findMethodPosition(file, methodName)
                        : new vscode.Position(0, 0);

                    return new vscode.Location(file, targetPos);
                }
            }
        )
    );

    // Provider 2: LWC HTML — <c-mi-componente> → JS del componente
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'html', pattern: '**/lwc/**/*.html' },
            {
                async provideDefinition(document, position) {
                    const config = vscode.workspace.getConfiguration('sf-tools');
                    if (!config.get('enableNavigation', true)) return null;

                    const line = document.lineAt(position).text;
                    const wordRange = document.getWordRangeAtPosition(position, /[a-z][a-z0-9-]*/);
                    if (!wordRange) return null;
                    const word = document.getText(wordRange);

                    const tagRe = /<([a-z][a-z0-9]*-[a-z0-9][a-z0-9-]*)/g;
                    let tagMatch;
                    while ((tagMatch = tagRe.exec(line)) !== null) {
                        const fullTag = tagMatch[1];
                        if (!fullTag.includes(word)) continue;
                        const parts = fullTag.split('-');
                        if (parts.length < 2) continue;
                        const componentName = parts.slice(1)
                            .map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1))
                            .join('');
                        const files = await vscode.workspace.findFiles(
                            `**/lwc/${componentName}/${componentName}.js`, '**/node_modules/**', 1
                        );
                        if (files.length > 0) return new vscode.Location(files[0], new vscode.Position(0, 0));
                    }
                    return null;
                }
            }
        )
    );

    // Provider 3: Apex .cls — navegación a clases y métodos
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'apex' },
            {
                async provideDefinition(document, position) {
                    const config = vscode.workspace.getConfiguration('sf-tools');
                    if (!config.get('enableNavigation', true)) return null;

                    const wordRange = document.getWordRangeAtPosition(position, /\w+/);
                    if (!wordRange) return null;
                    const word = document.getText(wordRange);
                    if (!word || word.length < 2 || APEX_KEYWORDS.has(word)) return null;

                    const line = document.lineAt(position).text;
                    const startChar = wordRange.start.character;
                    const endChar = wordRange.end.character;
                    const charBefore = startChar > 0 ? line.charAt(startChar - 1) : '';
                    const charAfter = line.charAt(endChar);

                    // Caso A: palabra después de punto → es un método o campo de otra clase
                    // Ej: MiClase.miMetodo() — cursor en "miMetodo"
                    if (charBefore === '.') {
                        const beforeDot = line.slice(0, startChar - 1);
                        const classNameMatch = /([A-Z]\w+)$/.exec(beforeDot);
                        if (classNameMatch) {
                            const file = await findClassFile(classNameMatch[1]);
                            if (file) {
                                const methodPos = await findMethodPosition(file, word);
                                return new vscode.Location(file, methodPos);
                            }
                        }
                    }

                    // Caso B: empieza por mayúscula → referencia a otra clase
                    // Ej: MiClase obj = new MiClase() — cursor en "MiClase"
                    if (/^[A-Z]/.test(word) && charAfter !== '(') {
                        const file = await findClassFile(word);
                        if (file) return new vscode.Location(file, new vscode.Position(0, 0));
                    }

                    // Caso C: llamada a método en la misma clase
                    // Ej: this.calcularTotal() o calcularTotal() — cursor en "calcularTotal"
                    if (charAfter === '(' || line.includes(`${word}(`)) {
                        const methodPos = await findMethodPosition(document.uri, word);
                        if (methodPos.line !== position.line) {
                            return new vscode.Location(document.uri, methodPos);
                        }
                    }

                    return null;
                }
            }
        )
    );
}

// ============================================================
// VALIDADOR DE IMPORTS LWC
// ============================================================

const importDiagnostics = vscode.languages.createDiagnosticCollection('sf-tools-imports');

function collectAllImports(text) {
    const imports = new Set();
    // import X from '...'
    const defaultRe = /import\s+(\w+)\s+from\s+['"][^'"]+['"]/g;
    let m;
    while ((m = defaultRe.exec(text)) !== null) imports.add(m[1]);
    // import { X, Y as Z } from '...'
    const namedRe = /import\s*\{([^}]+)\}\s*from/g;
    while ((m = namedRe.exec(text)) !== null) {
        m[1].split(',').forEach(s => {
            const name = s.trim().split(/\s+as\s+/).pop().trim();
            if (name) imports.add(name);
        });
    }
    return imports;
}

function collectApexImports(text) {
    const apexImports = new Map(); // name → line index
    const re = /import\s+(\w+)\s+from\s+'@salesforce\/apex\/([\w.]+)'/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const lineIndex = text.slice(0, m.index).split('\n').length - 1;
        apexImports.set(m[1], { line: lineIndex, fullPath: m[2] });
    }
    return apexImports;
}

function checkLwcImports(document) {
    if (document.languageId !== 'javascript' || !isLwc(document.fileName)) {
        importDiagnostics.delete(document.uri);
        return;
    }

    const text = document.getText();
    const allImports = collectAllImports(text);
    const apexImports = collectApexImports(text);
    const diagnostics = [];

    // 1. @wire(method) sin import
    const wireRe = /@wire\s*\(\s*(\w+)/g;
    let m;
    while ((m = wireRe.exec(text)) !== null) {
        const name = m[1];
        if (!allImports.has(name)) {
            const pos = document.positionAt(m.index);
            const range = new vscode.Range(pos, pos.translate(0, m[0].length));
            const d = new vscode.Diagnostic(
                range,
                `SF Tools: '${name}' usado en @wire sin import. ¿Falta: import ${name} from '@salesforce/apex/TuClase.${name}';?`,
                vscode.DiagnosticSeverity.Error
            );
            d.source = 'SF Tools';
            diagnostics.push(d);
        }
    }

    // 2. Llamada imperativa Apex: method({ }).then( sin import
    const imperativeRe = /\b(\w+)\s*\(\s*\{[^}]*\}\s*\)\s*\.(then|catch)\s*\(/g;
    const skipNames = new Set(['Promise', 'Object', 'Array', 'JSON', 'Math', 'console', 'fetch']);
    while ((m = imperativeRe.exec(text)) !== null) {
        const name = m[1];
        if (skipNames.has(name)) continue;
        if (!allImports.has(name)) {
            const pos = document.positionAt(m.index);
            const range = new vscode.Range(pos, pos.translate(0, name.length));
            const d = new vscode.Diagnostic(
                range,
                `SF Tools: '${name}' parece una llamada Apex imperativa sin import. ¿Falta: import ${name} from '@salesforce/apex/TuClase.${name}';?`,
                vscode.DiagnosticSeverity.Warning
            );
            d.source = 'SF Tools';
            diagnostics.push(d);
        }
    }

    // 3. Import de Apex que no se usa en ningún sitio
    for (const [name, info] of apexImports) {
        const usages = (text.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
        if (usages <= 1) { // solo el import en sí
            const lines = text.split('\n');
            const range = new vscode.Range(info.line, 0, info.line, lines[info.line].length);
            const d = new vscode.Diagnostic(
                range,
                `SF Tools: El import de Apex '${name}' (${info.fullPath}) no se usa en ningún @wire ni llamada imperativa.`,
                vscode.DiagnosticSeverity.Warning
            );
            d.source = 'SF Tools';
            diagnostics.push(d);
        }
    }

    importDiagnostics.set(document.uri, diagnostics);
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
    _ctx = context; // necesario para el Deployment Guard

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

    // Navegación Ctrl+Click
    registerNavigationProviders(context);

    // Comando manual para forzar validación de imports
    context.subscriptions.push(vscode.commands.registerCommand('sf-tools.checkImports', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        checkLwcImports(editor.document);
        vscode.window.showInformationMessage('SF Tools: Validación de imports completada. Revisa el panel Problems.');
    }));

    // Complexity + import check: actualizar al cambiar de editor
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;
        updateComplexityDecorations(editor);
        checkLwcImports(editor.document);
    }));

    // Complexity + import check: actualizar al editar (debounced)
    let debounceTimer;
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            updateComplexityDecorations(editor);
            checkLwcImports(editor.document);
        }, 800);
    }));

    // Validar todos los JS abiertos al arrancar
    vscode.workspace.textDocuments.forEach(checkLwcImports);

    // ── Deployment Guard ──
    context.subscriptions.push(
        vscode.commands.registerCommand('sf-tools.safeDeploy', cmdSafeDeploy),
        vscode.commands.registerCommand('sf-tools.trackedRetrieve', cmdTrackedRetrieve),
        vscode.commands.registerCommand('sf-tools.takeBackup', cmdTakeBackup),
        vscode.commands.registerCommand('sf-tools.toggleBackup', cmdToggleBackup),
        vscode.commands.registerCommand('sf-tools.compareBackup', cmdCompareBackup),
        vscode.commands.registerCommand('sf-tools.viewSyncStatus', cmdViewSyncStatus),
        vscode.commands.registerCommand('sf-tools.compareEnvironments', cmdCompareEnvironments),
        vscode.commands.registerCommand('sf-tools.listEnvDiffs', cmdListEnvDiffs),
        vscode.commands.registerCommand('sf-tools.help', cmdHelp)
    );

    // Initial render
    if (vscode.window.activeTextEditor) {
        updateComplexityDecorations(vscode.window.activeTextEditor);
        checkLwcImports(vscode.window.activeTextEditor.document);
    }
}

// ============================================================
// AYUDA — Webview con secciones colapsables
// ============================================================

function cmdHelp() {
    const panel = vscode.window.createWebviewPanel(
        'sfToolsHelp', 'SF Tools — Ayuda', vscode.ViewColumn.One,
        { enableScripts: false }
    );
    panel.webview.html = getHelpHtml();
}

function getHelpHtml() {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SF Tools — Ayuda</title>
<style>
  :root { --radius: 6px; --gap: 12px; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    max-width: 860px;
    margin: 0 auto;
    padding: 28px 24px 60px;
    line-height: 1.6;
  }
  h1 { font-size: 1.6em; margin-bottom: 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 28px; font-size: 0.95em; }
  .toc { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 32px; }
  .toc a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
    background: var(--vscode-badge-background);
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 0.85em;
  }
  .toc a:hover { text-decoration: underline; }

  details {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius);
    margin-bottom: var(--gap);
    overflow: hidden;
  }
  details[open] { border-color: var(--vscode-focusBorder); }
  summary {
    cursor: pointer;
    padding: 12px 16px;
    font-weight: 600;
    font-size: 1em;
    display: flex;
    align-items: center;
    gap: 10px;
    list-style: none;
    user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '▶';
    font-size: 0.7em;
    transition: transform 0.15s;
    color: var(--vscode-descriptionForeground);
  }
  details[open] summary::before { transform: rotate(90deg); }
  summary .icon { font-size: 1.15em; }
  summary .shortcut {
    margin-left: auto;
    font-weight: normal;
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
  }

  .body { padding: 0 16px 16px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 600px) { .row { grid-template-columns: 1fr; } }

  .card {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .card h4 { margin: 0 0 6px; font-size: 0.95em; }
  .card p  { margin: 0; font-size: 0.88em; color: var(--vscode-descriptionForeground); }

  kbd {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 4px;
    padding: 2px 7px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.82em;
    white-space: nowrap;
  }
  code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.88em;
  }
  pre {
    background: var(--vscode-textCodeBlock-background);
    border-radius: var(--radius);
    padding: 12px;
    overflow-x: auto;
    font-size: 0.85em;
    font-family: var(--vscode-editor-font-family);
    line-height: 1.5;
    margin: 10px 0 0;
  }
  .tag {
    display: inline-block;
    font-size: 0.75em;
    padding: 1px 7px;
    border-radius: 10px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .tag-auto { background: #1a5c2a; color: #7fe89c; }
  .tag-save { background: #1a3d5c; color: #7ec8e3; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88em; margin-top: 8px; }
  th { text-align: left; padding: 6px 10px; border-bottom: 2px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
  td { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .warn { color: #e8a94a; }
  .ok   { color: #7fe89c; }
  .err  { color: #f48a8a; }
  .sep  { border-top: 1px solid var(--vscode-panel-border); margin: 14px 0 10px; }
  ul { margin: 8px 0 0; padding-left: 20px; }
  li { margin-bottom: 4px; font-size: 0.9em; }
  .tip {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-focusBorder);
    padding: 8px 12px;
    border-radius: 0 4px 4px 0;
    font-size: 0.88em;
    margin-top: 10px;
  }
</style>
</head>
<body>

<h1>SF Tools</h1>
<p class="subtitle">Salesforce Developer Toolkit para VS Code — Todas las funciones explicadas</p>

<nav class="toc">
  <a href="#formato">🎨 Formato</a>
  <a href="#metricas">📊 Complejidad</a>
  <a href="#labels">🏷️ Custom Labels</a>
  <a href="#nav">🔍 Navegación</a>
  <a href="#imports">✅ Imports LWC</a>
  <a href="#guard">🛡️ Deploy Guard</a>
  <a href="#entornos">🌿 Entornos</a>
  <a href="#settings">⚙️ Ajustes</a>
</nav>

<!-- ── FORMATO ── -->
<details open id="formato">
  <summary><span class="icon">🎨</span> Formato y Código<span class="shortcut"><kbd>Ctrl+Shift+Alt+F</kbd> Run All</span></summary>
  <div class="body">
    <div class="row">
      <div class="card">
        <h4>Run All <kbd>Ctrl+Shift+Alt+F</kbd></h4>
        <p>Un solo atajo que ejecuta todas las operaciones que tengas activadas en Ajustes → SF Tools → Run All. Si nada está activado, avisa sin hacer nada.</p>
      </div>
      <div class="card">
        <h4>Expand If Blocks <kbd>Ctrl+Shift+Alt+I</kbd> <span class="tag tag-save">al guardar</span></h4>
        <p>Convierte <code>if(x) return;</code> en bloque con llaves. Necesario para cumplir la regla PMD <code>IfStmtsMustUseBraces</code>. No toca líneas con llaves ni comentarios.</p>
        <pre>// Antes:
if(acc == null) return;

// Después:
if(acc == null) {
    return;
}</pre>
      </div>
      <div class="card">
        <h4>Colapsar SOQL <kbd>Ctrl+Shift+Alt+S</kbd></h4>
        <p>Colapsa queries <code>[SELECT…]</code> multilínea a una sola línea. Solo actúa si hay <code>SELECT</code> — no toca otras expresiones con corchetes.</p>
        <pre>// Antes:
[   SELECT Id
    FROM Account
    WHERE IsActive = true ]
// Después:
[SELECT Id FROM Account WHERE IsActive = true]</pre>
      </div>
      <div class="card">
        <h4>Colapsar atributos HTML <kbd>Ctrl+Shift+Alt+H</kbd></h4>
        <p>Colapsa tags Aura/LWC/VF multilínea a una sola línea. Preserva espacios dentro de valores entre comillas.</p>
        <pre>&lt;!-- Antes: --&gt;
&lt;lightning:input label="ID"
                 value="{!v.id}"
                 required="true" /&gt;
&lt;!-- Después: --&gt;
&lt;lightning:input label="ID" value="{!v.id}" required="true" /&gt;</pre>
      </div>
      <div class="card">
        <h4>Colapsar métodos @isTest <kbd>Ctrl+Shift+Alt+T</kbd></h4>
        <p>Encuentra todos los métodos anotados con <code>@isTest</code> y los colapsa en el editor. Permite ver solo el código productivo sin cerrar el archivo. Descolapsar: <kbd>Ctrl+K Ctrl+J</kbd>.</p>
      </div>
    </div>
  </div>
</details>

<!-- ── MÉTRICAS ── -->
<details id="metricas">
  <summary><span class="icon">📊</span> Métricas de complejidad <span class="tag tag-auto">automático</span><span class="shortcut">solo Apex .cls</span></summary>
  <div class="body">
    <p>Aparecen automáticamente al final de cada firma de método en archivos <code>.cls</code>. Se actualizan 800ms después de que dejes de escribir. Color basado en la CC: <span class="ok">●</span> verde ≤5 · <span class="warn">●</span> naranja 6–10 · <span class="err">●</span> rojo &gt;10.</p>
    <pre>public void procesarPedido(Order o, Boolean flag) {   <span class="ok">CC:4 · COG:6</span> · LOC:18 · Params:2</pre>
    <div class="sep"></div>
    <table>
      <tr><th>Métrica</th><th>Qué mide</th><th>Por defecto</th></tr>
      <tr><td><strong>CC</strong> — Ciclomática</td><td>Puntos de decisión: <code>if</code>, <code>for</code>, <code>while</code>, <code>case</code>, <code>catch</code>, <code>&amp;&amp;</code>, <code>||</code>, ternario. Base 1.</td><td><span class="ok">ON</span></td></tr>
      <tr><td><strong>COG</strong> — Cognitiva</td><td>Como la ciclomática pero añade peso por cada nivel de anidamiento. Refleja mejor lo difícil que es leer el código.</td><td><span class="ok">ON</span></td></tr>
      <tr><td><strong>LOC</strong> — Líneas</td><td>Líneas no vacías y no comentadas dentro del método. Métodos &gt;30 LOC suelen necesitar extracción.</td><td>OFF</td></tr>
      <tr><td><strong>Params</strong> — Parámetros</td><td>Número de parámetros. Más de 4 indica que el método hace demasiado.</td><td>OFF</td></tr>
      <tr><td><strong>Depth</strong> — Anidamiento</td><td>Aparece en cada línea <code>if</code>/<code>for</code>/<code>while</code> que abre un bloque. Verde ≤1, naranja 2–3, <span class="err">rojo ≥4</span>. Señala exactamente la línea problemática.</td><td>OFF</td></tr>
    </table>
    <p style="margin-top:10px">Activar/desactivar todo: <kbd>Ctrl+Shift+P</kbd> → <em>SF Tools: Activar/Desactivar complejidad</em> · O en Ajustes → <code>sf-tools.showComplexity</code>.</p>
  </div>
</details>

<!-- ── CUSTOM LABELS ── -->
<details id="labels">
  <summary><span class="icon">🏷️</span> Extraer a Custom Label<span class="shortcut">Clic derecho con texto seleccionado</span></summary>
  <div class="body">
    <p>Selecciona cualquier texto hardcodeado → clic derecho → <strong>SF Tools → Extraer a Custom Label</strong>.</p>
    <ul>
      <li>Genera automáticamente el API name desde el texto seleccionado (editable antes de confirmar)</li>
      <li>Reemplaza el texto con la referencia correcta según el tipo de archivo</li>
      <li>Crea o actualiza <code>force-app/main/default/labels/CustomLabels.labels-meta.xml</code></li>
      <li>Abre el XML automáticamente al lado para revisión</li>
      <li>Pregunta si quieres hacer deploy inmediatamente</li>
    </ul>
    <div class="sep"></div>
    <table>
      <tr><th>Archivo</th><th>Reemplaza por</th><th>Acción extra</th></tr>
      <tr><td>Apex <code>.cls</code></td><td><code>Label.Mi_Label</code></td><td>—</td></tr>
      <tr><td>LWC <code>.js</code></td><td><code>MI_LABEL</code></td><td>Añade <code>import MI_LABEL from '@salesforce/label/c.Mi_Label'</code> automáticamente</td></tr>
      <tr><td>LWC <code>.html</code></td><td><code>{miLabel}</code></td><td>Añade el import al JS hermano + avisa que añadas la propiedad a la clase</td></tr>
      <tr><td>Aura / VF</td><td><code>{!$Label.c.Mi_Label}</code></td><td>—</td></tr>
    </table>
    <div class="tip">Requiere Salesforce CLI (<code>sf</code>) instalado y org autorizada para el deploy opcional.</div>
  </div>
</details>

<!-- ── NAVEGACIÓN ── -->
<details id="nav">
  <summary><span class="icon">🔍</span> Navegación Ctrl+Click<span class="shortcut">No invasivo — solo activa en contextos específicos</span></summary>
  <div class="body">
    <p>Proveedores de Go-to-Definition que solo se activan donde el Salesforce Extension Pack no llega. Desactivar: <code>sf-tools.enableNavigation = false</code>.</p>
    <div class="row">
      <div class="card">
        <h4>Desde Apex <code>.cls</code></h4>
        <pre>MiClase.miMetodo(params);
// Ctrl+Click en "MiClase" → abre MiClase.cls
// Ctrl+Click en "miMetodo" → salta al método

MiWrapper obj = new MiWrapper();
// Ctrl+Click en "MiWrapper" → abre MiWrapper.cls

this.calcularTotal();
// Ctrl+Click en "calcularTotal" → salta en el mismo archivo</pre>
      </div>
      <div class="card">
        <h4>Desde LWC <code>.js</code></h4>
        <pre>import getList from '@salesforce/apex/AccountCtrl.getList';
// Ctrl+Click en "AccountCtrl" → abre AccountCtrl.cls (inicio)
// Ctrl+Click en "getList" → salta al método exacto</pre>
        <h4 style="margin-top:12px">Desde LWC <code>.html</code></h4>
        <pre>&lt;c-invoice-card record-id={id}&gt;&lt;/c-invoice-card&gt;
// Ctrl+Click en "invoice-card" → abre lwc/invoiceCard/invoiceCard.js</pre>
      </div>
    </div>
  </div>
</details>

<!-- ── IMPORTS LWC ── -->
<details id="imports">
  <summary><span class="icon">✅</span> Validador de imports Apex en LWC <span class="tag tag-auto">automático</span><span class="shortcut">solo LWC .js</span></summary>
  <div class="body">
    <p>Se ejecuta automáticamente al abrir o editar un <code>.js</code> de LWC. Los errores aparecen en el panel <strong>Problems</strong> (<kbd>Ctrl+Shift+M</kbd>) y son clickables para ir a la línea.</p>
    <div class="sep"></div>
    <table>
      <tr><th>Tipo</th><th>Qué detecta</th><th>Ejemplo</th></tr>
      <tr><td><span class="err">❌ Error</span></td><td><code>@wire(método)</code> donde <code>método</code> no tiene import</td><td><code>@wire(getAccounts)</code> sin <code>import getAccounts from '…'</code></td></tr>
      <tr><td><span class="warn">⚠️ Warning</span></td><td>Llamada imperativa <code>método({}).then(</code> sin import</td><td><code>saveRecord({…}).then(r =&gt; …)</code> sin import</td></tr>
      <tr><td><span class="warn">⚠️ Warning</span></td><td>Import de Apex que no se usa en ningún <code>@wire</code> ni llamada</td><td><code>import getContacts from '…'</code> sin usarlo</td></tr>
    </table>
    <p style="margin-top:10px">Ejecutar manualmente: <kbd>Ctrl+Shift+P</kbd> → <em>SF Tools: Validar imports de Apex en LWC</em>.</p>
  </div>
</details>

<!-- ── DEPLOYMENT GUARD ── -->
<details id="guard">
  <summary><span class="icon">🛡️</span> Deployment Guard<span class="shortcut"><kbd>Ctrl+Shift+Alt+D</kbd> · <kbd>Ctrl+Shift+Alt+R</kbd></span></summary>
  <div class="body">
    <div class="tip" style="margin-bottom:14px">⚠️ <strong>Safe Deploy ≠ <code>sf project deploy start</code> desde el CLI.</strong> El CLI normal no pasa por la extensión y no detecta conflictos. Usa siempre SF Tools Safe Deploy para tener protección.</div>
    <div class="row">
      <div class="card">
        <h4>Safe Deploy <kbd>Ctrl+Shift+Alt+D</kbd></h4>
        <p>Antes de deployar consulta <code>LastModifiedDate</code> del componente en la org y lo compara con tu timestamp de último retrieve.</p>
        <ul>
          <li><span class="ok">Sin conflicto</span> → backup opcional → deploy → guarda timestamp</li>
          <li><span class="err">Con conflicto</span> → avisa quién y cuándo modificó → opciones: Ver diff · Deploy igualmente · Cancelar</li>
        </ul>
        <p style="margin-top:8px"><strong>Metadata soportada:</strong> ApexClass, ApexTrigger, LWC, Aura, ApexPage, ApexComponent, Flow.</p>
      </div>
      <div class="card">
        <h4>Tracked Retrieve <kbd>Ctrl+Shift+Alt+R</kbd></h4>
        <p>Recupera el archivo desde la org (<code>sf project retrieve start</code>) <strong>y guarda el timestamp</strong>. Este timestamp es el que usa Safe Deploy para detectar futuros conflictos.</p>
        <p style="margin-top:8px">Si el backup automático está activado para este archivo, crea backup antes de recuperar.</p>
      </div>
      <div class="card">
        <h4>Crear Backup</h4>
        <p>Crea un backup inmediato del archivo actual sin deployar. Guardado en <code>.sf-tools-backups/{org}/{tipo}/{nombre}/{timestamp}/</code>. Máximo 5 por archivo (configurable).</p>
      </div>
      <div class="card">
        <h4>Gestionar Backups</h4>
        <p>Muestra todas las versiones guardadas de un archivo. Por cada backup puedes:</p>
        <ul>
          <li><strong>Comparar</strong> — diff backup ↔ archivo local actual</li>
          <li><strong>Restaurar</strong> — reemplaza el archivo (guarda el estado actual como nuevo backup antes)</li>
          <li><strong>Renombrar</strong> — ponle nombre descriptivo ("Antes de refactor login")</li>
          <li><strong>Bloquear 🔒</strong> — no se elimina aunque supere el máximo</li>
          <li><strong>Eliminar</strong> — borra el backup (solo si no está bloqueado)</li>
        </ul>
      </div>
      <div class="card">
        <h4>Activar/Desactivar Backup Automático</h4>
        <p>Toggle por archivo individual. Cuando está activo, se crea backup automáticamente en cada Tracked Retrieve.</p>
      </div>
      <div class="card">
        <h4>Ver estado de sync</h4>
        <p>Lista todos los archivos que SF Tools está trackeando con sus timestamps de último retrieve. Para cada uno muestra nombre, tipo de metadata y hace cuánto tiempo fue el último retrieve. Desde aquí puedes limpiar timestamps individuales o todos a la vez (útil para resetear el seguimiento de un archivo).</p>
      </div>
    </div>
  </div>
</details>

<!-- ── ENTORNOS ── -->
<details id="entornos">
  <summary><span class="icon">🌿</span> Comparación de entornos (DEV / PRE / PREPROD / PROD)<span class="shortcut">100% git · sin conexión a org</span></summary>
  <div class="body">
    <p>Compara metadata Salesforce entre entornos usando ramas git locales. No necesita conexión a ninguna org. Configura las ramas en Ajustes → SF Tools → Environments.</p>
    <div class="tip" style="margin-bottom:14px">Ejecuta <code>git fetch --all</code> antes de usar esta función para tener las ramas actualizadas.</div>
    <div class="row">
      <div class="card">
        <h4>Comparar entornos (archivo actual)</h4>
        <p>Abre el diff de VS Code con el archivo activo comparado entre dos entornos. Seleccionas los dos entornos y se abre inmediatamente la vista de diferencias.</p>
        <pre>AccountController.cls — PRE ↔ PREPROD
┌──────────────┬──────────────────┐
│ PRE          │ PREPROD          │
│ if(x==null)  │ if(x == null) {  │
│   return;    │     return;      │
│              │ }                │
└──────────────┴──────────────────┘</pre>
      </div>
      <div class="card">
        <h4>Ver todos los archivos diferentes entre entornos</h4>
        <p>Ejecuta <code>git diff --name-only branch1...branch2 -- force-app/</code> y muestra la lista completa de archivos de metadata que difieren. Haz clic en cualquiera para ver su diff.</p>
        <pre>7 archivo(s) diferentes: PRE ↔ PREPROD

AccountController.cls   classes/
InvoiceService.cls      classes/
invoiceCard.js          lwc/invoiceCard/
invoiceCard.html        lwc/invoiceCard/
CustomLabels.xml        labels/
OrderFlow.flow-meta.xml flows/</pre>
      </div>
    </div>
    <div class="sep"></div>
    <table>
      <tr><th>Setting</th><th>Default</th><th>Descripción</th></tr>
      <tr><td><code>sf-tools.environments.dev</code></td><td><code>dev</code></td><td>Rama git del entorno DEV</td></tr>
      <tr><td><code>sf-tools.environments.pre</code></td><td><code>pre</code></td><td>Rama git del entorno PRE</td></tr>
      <tr><td><code>sf-tools.environments.preprod</code></td><td><code>preprod</code></td><td>Rama git del entorno PREPROD</td></tr>
      <tr><td><code>sf-tools.environments.prod</code></td><td><code>main</code></td><td>Rama git del entorno PROD</td></tr>
    </table>
  </div>
</details>

<!-- ── SETTINGS ── -->
<details id="settings">
  <summary><span class="icon">⚙️</span> Referencia completa de Ajustes</summary>
  <div class="body">
    <table>
      <tr><th>Setting</th><th>Default</th><th>Descripción</th></tr>
      <tr><td><code>expandOnSave</code></td><td>true</td><td>Expandir if blocks al guardar archivos Apex/JS</td></tr>
      <tr><td><code>showComplexity</code></td><td>true</td><td>Mostrar métricas de complejidad en Apex</td></tr>
      <tr><td><code>complexity.cyclomatic</code></td><td>true</td><td>Mostrar Complejidad Ciclomática (CC)</td></tr>
      <tr><td><code>complexity.cognitive</code></td><td>true</td><td>Mostrar Complejidad Cognitiva (COG)</td></tr>
      <tr><td><code>complexity.loc</code></td><td>false</td><td>Mostrar Líneas de Código (LOC)</td></tr>
      <tr><td><code>complexity.params</code></td><td>false</td><td>Mostrar número de parámetros</td></tr>
      <tr><td><code>complexity.nesting</code></td><td>false</td><td>Mostrar profundidad de anidamiento por línea</td></tr>
      <tr><td><code>runAll.expandIfs</code></td><td>true</td><td>Incluir expansión de ifs en Run All</td></tr>
      <tr><td><code>runAll.formatDocument</code></td><td>true</td><td>Incluir indentación en Run All</td></tr>
      <tr><td><code>runAll.collapseSoql</code></td><td>true</td><td>Incluir colapso de SOQL en Run All</td></tr>
      <tr><td><code>runAll.collapseHtml</code></td><td>false</td><td>Incluir colapso de HTML en Run All</td></tr>
      <tr><td><code>runAll.collapseTests</code></td><td>false</td><td>Incluir colapso de @isTest en Run All</td></tr>
      <tr><td><code>enableNavigation</code></td><td>true</td><td>Activar Ctrl+Click navigation</td></tr>
      <tr><td><code>deployGuard.autoBackupOnDeploy</code></td><td>true</td><td>Backup automático antes de cada Safe Deploy</td></tr>
      <tr><td><code>deployGuard.maxBackupsPerFile</code></td><td>5</td><td>Máximo de backups por archivo</td></tr>
      <tr><td><code>environments.dev</code></td><td>dev</td><td>Rama git del entorno DEV</td></tr>
      <tr><td><code>environments.pre</code></td><td>pre</td><td>Rama git del entorno PRE</td></tr>
      <tr><td><code>environments.preprod</code></td><td>preprod</td><td>Rama git del entorno PREPROD</td></tr>
      <tr><td><code>environments.prod</code></td><td>main</td><td>Rama git del entorno PROD</td></tr>
    </table>
  </div>
</details>

<p style="margin-top:32px; color: var(--vscode-descriptionForeground); font-size:0.82em; text-align:center">
  SF Tools v1.0.0 · <kbd>Ctrl+Shift+P</kbd> → <em>SF Tools: Ayuda</em> para volver aquí · Clic derecho en cualquier editor → <strong>SF Tools</strong>
</p>

</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };

// ============================================================
// DEPLOYMENT GUARD
// ============================================================

let _ctx; // referencia al contexto de extensión, asignada en activate()

// --- Utilidades ---

function getTimeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'Ahora mismo';
    const m = Math.floor(s / 60); if (m < 60) return `hace ${m}m`;
    const h = Math.floor(m / 60); if (h < 24) return `hace ${h}h`;
    const d = Math.floor(h / 24); if (d < 30)  return `hace ${d}d`;
    const mo = Math.floor(d / 30); if (mo < 12) return `hace ${mo} meses`;
    return `hace ${Math.floor(mo / 12)} años`;
}

function sanitizeSOQL(str) { return str.replace(/'/g, "\\'"); }

function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
}

// Detecta tipo de metadata y nombre desde la ruta del archivo
function getMetadataInfo(filePath) {
    const norm = filePath.replace(/\\/g, '/');
    const base = path.basename(filePath);
    if (norm.includes('/classes/') && base.endsWith('.cls'))
        return { type: 'ApexClass', name: base.replace('.cls', ''), soqlObj: 'ApexClass', nameField: 'Name' };
    if (norm.includes('/triggers/') && base.endsWith('.trigger'))
        return { type: 'ApexTrigger', name: base.replace('.trigger', ''), soqlObj: 'ApexTrigger', nameField: 'Name' };
    if (norm.includes('/lwc/')) {
        const m = norm.match(/\/lwc\/([^/]+)/);
        if (m) return { type: 'LightningComponentBundle', name: m[1], soqlObj: 'LightningComponentBundle', nameField: 'DeveloperName' };
    }
    if (norm.includes('/aura/')) {
        const m = norm.match(/\/aura\/([^/]+)/);
        if (m) return { type: 'AuraDefinitionBundle', name: m[1], soqlObj: 'AuraDefinitionBundle', nameField: 'DeveloperName' };
    }
    if (norm.includes('/pages/') && base.endsWith('.page'))
        return { type: 'ApexPage', name: base.replace('.page', ''), soqlObj: 'ApexPage', nameField: 'Name' };
    if (norm.includes('/components/') && base.endsWith('.component'))
        return { type: 'ApexComponent', name: base.replace('.component', ''), soqlObj: 'ApexComponent', nameField: 'Name' };
    if (norm.includes('/flows/') && base.endsWith('.flow-meta.xml'))
        return { type: 'Flow', name: base.replace('.flow-meta.xml', ''), soqlObj: 'Flow', nameField: 'DeveloperName' };
    if (norm.includes('/objects/') && base.endsWith('.object-meta.xml'))
        return { type: 'CustomObject', name: base.replace('.object-meta.xml', ''), soqlObj: null, nameField: null };
    return null;
}

// --- SF CLI Runner ---

function runSfCommand(args, cwd) {
    return new Promise((resolve) => {
        const sfBin = process.platform === 'win32' ? 'sf.cmd' : 'sf';
        execFile(sfBin, args, { cwd: cwd || getWorkspaceRoot(), timeout: 120000, maxBuffer: 20 * 1024 * 1024 },
            (err, stdout, stderr) => resolve({ stdout: stdout || '', stderr: stderr || '', code: err?.code ?? 0 })
        );
    });
}

// --- Storage (workspace state) ---

const KEY_RET  = (orgId, type, name) => `sftools_ret_${orgId}_${type}_${name}`;
const KEY_BPRE = (orgId, type, name) => `sftools_bkp_${orgId}_${type}_${name}`;
const KEY_BMET = (orgId, type, name) => `sftools_bkpmeta_${orgId}_${type}_${name}`;
const KEY_IDX  = 'sftools_ret_index'; // índice de todas las claves de retrieve

function getRetrieveTimestamp(orgId, type, name) { return _ctx.workspaceState.get(KEY_RET(orgId, type, name)); }
async function saveRetrieveTimestamp(orgId, type, name) {
    const key = KEY_RET(orgId, type, name);
    await _ctx.workspaceState.update(key, new Date().toISOString());
    const idx = _ctx.workspaceState.get(KEY_IDX, []);
    if (!idx.includes(key)) { idx.push(key); await _ctx.workspaceState.update(KEY_IDX, idx); }
}
async function clearRetrieveTimestamp(key) {
    await _ctx.workspaceState.update(key, undefined);
    const idx = _ctx.workspaceState.get(KEY_IDX, []).filter(k => k !== key);
    await _ctx.workspaceState.update(KEY_IDX, idx);
}

function isBackupEnabled(orgId, type, name) { return _ctx.workspaceState.get(KEY_BPRE(orgId, type, name), false); }
function setBackupEnabled(orgId, type, name, val) { return _ctx.workspaceState.update(KEY_BPRE(orgId, type, name), val); }
function getBackupMeta(orgId, type, name) { return _ctx.workspaceState.get(KEY_BMET(orgId, type, name), []); }
function saveBackupMeta(orgId, type, name, meta) { return _ctx.workspaceState.update(KEY_BMET(orgId, type, name), meta); }

// --- Info de la org ---

let _orgCache = null;
let _orgCacheTime = 0;
async function getCurrentOrgInfo() {
    if (_orgCache && Date.now() - _orgCacheTime < 30 * 60 * 1000) return _orgCache;
    const res = await runSfCommand(['org', 'display', '--json']);
    try {
        const json = JSON.parse(res.stdout);
        _orgCache = json.result || null;
        _orgCacheTime = Date.now();
        return _orgCache;
    } catch { return null; }
}

// --- Detección de conflictos ---

async function checkConflict(metaInfo, orgAlias, lastRetrieved) {
    if (!metaInfo.soqlObj) return { hasConflict: false }; // tipo sin SOQL (ej: CustomObject)
    const query = `SELECT Id, LastModifiedDate, LastModifiedBy.Name FROM ${metaInfo.soqlObj} WHERE ${metaInfo.nameField} = '${sanitizeSOQL(metaInfo.name)}'`;
    const args = ['data', 'query', '--query', query, '--json'];
    if (orgAlias) args.push('--target-org', orgAlias);
    const res = await runSfCommand(args);
    try {
        const records = JSON.parse(res.stdout).result?.records || [];
        if (!records.length) return { hasConflict: false };
        const orgModified = new Date(records[0].LastModifiedDate);
        const modifiedBy = records[0].LastModifiedBy?.Name || 'Desconocido';
        if (!lastRetrieved) return { hasConflict: true, conflictType: 'unknown', modifiedBy, modifiedDate: records[0].LastModifiedDate, reason: 'Sin timestamp local — versión org desconocida' };
        if (orgModified > new Date(lastRetrieved)) return { hasConflict: true, conflictType: 'conflict', modifiedBy, modifiedDate: records[0].LastModifiedDate, reason: `Modificado en org ${getTimeAgo(orgModified)} por ${modifiedBy}` };
        return { hasConflict: false };
    } catch { return { hasConflict: false }; }
}

// --- Servicio de Backups ---

const MAX_BACKUPS = 5;

function backupBaseDir(orgAlias, metaInfo) {
    return path.join(getWorkspaceRoot(), '.sf-tools-backups', orgAlias, metaInfo.type, metaInfo.name);
}

async function createBackup(filePath, orgAlias, metaInfo) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(backupBaseDir(orgAlias, metaInfo), timestamp);
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupDir));
        await vscode.workspace.fs.copy(
            vscode.Uri.file(filePath),
            vscode.Uri.file(path.join(backupDir, path.basename(filePath))),
            { overwrite: true }
        );
        const orgInfo = await getCurrentOrgInfo();
        const orgId = orgInfo?.id || orgAlias;
        const metas = getBackupMeta(orgId, metaInfo.type, metaInfo.name);
        metas.unshift({ timestamp, label: timestamp, locked: false, dir: backupDir });
        // Eliminar los más antiguos desbloqueados si supera el máximo
        const unlocked = metas.filter(m => !m.locked);
        while (unlocked.length > MAX_BACKUPS) {
            const oldest = unlocked.pop();
            try { await vscode.workspace.fs.delete(vscode.Uri.file(oldest.dir), { recursive: true }); } catch {}
            const idx = metas.findIndex(m => m.timestamp === oldest.timestamp);
            if (idx !== -1) metas.splice(idx, 1);
        }
        await saveBackupMeta(orgId, metaInfo.type, metaInfo.name, metas);
        return { success: true, timestamp };
    } catch (e) { return { success: false, error: e.message }; }
}

// --- Diff viewer: local vs org ---

async function showDiffVsOrg(filePath, metaInfo, orgAlias) {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Tools: Obteniendo versión de org para ${metaInfo.name}...` },
        async () => {
            const tmpDir = path.join(os.tmpdir(), 'sf-tools-diff', metaInfo.type, metaInfo.name);
            try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir)); } catch {}
            const args = ['project', 'retrieve', 'start', '--source-dir', filePath, '--output-dir', tmpDir, '--json'];
            if (orgAlias) args.push('--target-org', orgAlias);
            await runSfCommand(args);
            // Intentar encontrar el archivo recuperado
            let orgFile = path.join(tmpDir, path.basename(filePath));
            try {
                const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(tmpDir));
                for (const [name] of entries) {
                    if (name === path.basename(filePath)) { orgFile = path.join(tmpDir, name); break; }
                }
            } catch {}
            await vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.file(orgFile),
                vscode.Uri.file(filePath),
                `${metaInfo.name} — Org ↔ Local`
            );
        }
    );
}

// ============================================================
// DEPLOYMENT GUARD — Comandos
// ============================================================

async function cmdSafeDeploy() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('SF Tools: Abre el archivo a deployar.'); return; }
    const filePath = editor.document.fileName;
    const metaInfo = getMetadataInfo(filePath);
    if (!metaInfo) { vscode.window.showWarningMessage('SF Tools: Tipo de metadata no soportado. Soportados: Apex, Trigger, LWC, Aura, VF Page/Component, Flow.'); return; }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Tools: Comprobando conflictos en ${metaInfo.name}...`, cancellable: false },
        async (progress) => {
            const orgInfo = await getCurrentOrgInfo();
            if (!orgInfo) { vscode.window.showErrorMessage('SF Tools: No se pudo conectar con la org. ¿Está autenticado con sf org login?'); return; }
            const orgAlias = orgInfo.alias || orgInfo.username;
            const orgId = orgInfo.id || orgAlias;
            const lastRetrieved = getRetrieveTimestamp(orgId, metaInfo.type, metaInfo.name);

            progress.report({ message: 'Consultando última modificación en org...' });
            const conflict = await checkConflict(metaInfo, orgAlias, lastRetrieved);

            if (conflict.hasConflict) {
                const answer = await vscode.window.showWarningMessage(
                    `⚠️ Conflicto en ${metaInfo.name}: ${conflict.reason}`,
                    'Ver diferencias', 'Deploy igualmente', 'Cancelar'
                );
                if (!answer || answer === 'Cancelar') return;
                if (answer === 'Ver diferencias') { await showDiffVsOrg(filePath, metaInfo, orgAlias); return; }
            }

            // Backup previo al deploy si está configurado
            const cfg = vscode.workspace.getConfiguration('sf-tools');
            if (cfg.get('deployGuard.autoBackupOnDeploy', true) || isBackupEnabled(orgId, metaInfo.type, metaInfo.name)) {
                progress.report({ message: 'Creando backup previo al deploy...' });
                await createBackup(filePath, orgAlias, metaInfo);
            }

            progress.report({ message: 'Deploying...' });
            const res = await runSfCommand(['project', 'deploy', 'start', '--source-dir', filePath, '--json']);
            try {
                const json = JSON.parse(res.stdout);
                if (json.result?.success || res.code === 0) {
                    await saveRetrieveTimestamp(orgId, metaInfo.type, metaInfo.name);
                    vscode.window.showInformationMessage(`SF Tools: ✅ Deploy de ${metaInfo.name} completado.`);
                } else {
                    const errs = (json.result?.details?.componentFailures || []).map(f => f.problem).join(' | ') || json.message || 'Error desconocido';
                    vscode.window.showErrorMessage(`SF Tools: ❌ Deploy fallido en ${metaInfo.name}: ${errs}`);
                }
            } catch {
                res.code === 0
                    ? vscode.window.showInformationMessage(`SF Tools: ✅ Deploy de ${metaInfo.name} completado.`)
                    : vscode.window.showErrorMessage(`SF Tools: ❌ Error en deploy. Revisa la terminal.`);
            }
        }
    );
}

async function cmdTrackedRetrieve() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('SF Tools: Abre el archivo a recuperar.'); return; }
    const filePath = editor.document.fileName;
    const metaInfo = getMetadataInfo(filePath);
    if (!metaInfo) { vscode.window.showWarningMessage('SF Tools: Tipo de metadata no soportado.'); return; }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Tools: Recuperando ${metaInfo.name} desde org...`, cancellable: false },
        async () => {
            const orgInfo = await getCurrentOrgInfo();
            if (!orgInfo) { vscode.window.showErrorMessage('SF Tools: No se pudo conectar con la org.'); return; }
            const orgAlias = orgInfo.alias || orgInfo.username;
            const orgId = orgInfo.id || orgAlias;
            if (isBackupEnabled(orgId, metaInfo.type, metaInfo.name)) {
                await createBackup(filePath, orgAlias, metaInfo);
            }
            const res = await runSfCommand(['project', 'retrieve', 'start', '--source-dir', filePath, '--json']);
            if (res.code === 0) {
                await saveRetrieveTimestamp(orgId, metaInfo.type, metaInfo.name);
                vscode.window.showInformationMessage(`SF Tools: ✅ ${metaInfo.name} recuperado y timestamp guardado.`);
            } else {
                vscode.window.showErrorMessage(`SF Tools: ❌ Error al recuperar ${metaInfo.name}.`);
            }
        }
    );
}

async function cmdTakeBackup() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const filePath = editor.document.fileName;
    const metaInfo = getMetadataInfo(filePath);
    if (!metaInfo) { vscode.window.showWarningMessage('SF Tools: Tipo de metadata no soportado.'); return; }
    const orgInfo = await getCurrentOrgInfo();
    const orgAlias = orgInfo?.alias || orgInfo?.username || 'default';
    const result = await createBackup(filePath, orgAlias, metaInfo);
    result.success
        ? vscode.window.showInformationMessage(`SF Tools: Backup creado (${result.timestamp}).`)
        : vscode.window.showErrorMessage(`SF Tools: Error al crear backup: ${result.error}`);
}

async function cmdToggleBackup() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const filePath = editor.document.fileName;
    const metaInfo = getMetadataInfo(filePath);
    if (!metaInfo) { vscode.window.showWarningMessage('SF Tools: Tipo de metadata no soportado.'); return; }
    const orgInfo = await getCurrentOrgInfo();
    const orgId = orgInfo?.id || orgInfo?.alias || 'default';
    const current = isBackupEnabled(orgId, metaInfo.type, metaInfo.name);
    await setBackupEnabled(orgId, metaInfo.type, metaInfo.name, !current);
    vscode.window.showInformationMessage(`SF Tools: Backup automático ${!current ? '✅ activado' : '❌ desactivado'} para ${metaInfo.name}.`);
}

async function cmdCompareBackup() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const filePath = editor.document.fileName;
    const metaInfo = getMetadataInfo(filePath);
    if (!metaInfo) { vscode.window.showWarningMessage('SF Tools: Tipo de metadata no soportado.'); return; }
    const orgInfo = await getCurrentOrgInfo();
    const orgId = orgInfo?.id || orgInfo?.alias || 'default';
    const orgAlias = orgInfo?.alias || orgInfo?.username || 'default';
    const metas = getBackupMeta(orgId, metaInfo.type, metaInfo.name);
    if (!metas.length) { vscode.window.showInformationMessage(`SF Tools: No hay backups para ${metaInfo.name}. Usa "Crear Backup" o activa el backup automático.`); return; }

    const items = metas.map(m => ({
        label: m.label !== m.timestamp ? m.label : getTimeAgo(m.timestamp.replace(/-(\d{2})-(\d{3})Z$/, ':$1.$2Z').replace(/T(\d{2})-(\d{2})-/, 'T$1:$2:')),
        description: `${m.locked ? '🔒 Bloqueado  ' : ''}${new Date(m.timestamp.replace(/-(\d{2})-(\d{3})Z$/, ':$1.$2Z').replace(/T(\d{2})-(\d{2})-/, 'T$1:$2:')).toLocaleString()}`,
        detail: m.dir,
        meta: m
    }));

    const selected = await vscode.window.showQuickPick(items, { placeHolder: `Backups de ${metaInfo.name} — elige versión` });
    if (!selected) return;

    const action = await vscode.window.showQuickPick([
        { label: '$(diff) Comparar con versión actual', value: 'compare' },
        { label: '$(history) Restaurar este backup', value: 'restore' },
        { label: '$(edit) Renombrar backup', value: 'rename' },
        { label: selected.meta.locked ? '$(unlock) Desbloquear' : '$(lock) Bloquear', value: 'lock' },
        { label: '$(trash) Eliminar backup', value: 'delete' }
    ], { placeHolder: '¿Qué quieres hacer con este backup?' });
    if (!action) return;

    const backupFile = path.join(selected.meta.dir, path.basename(filePath));

    switch (action.value) {
        case 'compare':
            await vscode.commands.executeCommand('vscode.diff',
                vscode.Uri.file(backupFile), vscode.Uri.file(filePath),
                `${metaInfo.name} — Backup (${selected.label}) ↔ Local actual`
            );
            break;
        case 'restore': {
            const confirm = await vscode.window.showWarningMessage(
                `¿Restaurar backup "${selected.label}"? El archivo actual se guardará como nuevo backup antes de restaurar.`,
                'Sí, restaurar', 'Cancelar'
            );
            if (confirm !== 'Sí, restaurar') break;
            await createBackup(filePath, orgAlias, metaInfo);
            await vscode.workspace.fs.copy(vscode.Uri.file(backupFile), vscode.Uri.file(filePath), { overwrite: true });
            vscode.window.showInformationMessage('SF Tools: ✅ Backup restaurado. Estado anterior guardado como nuevo backup.');
            break;
        }
        case 'rename': {
            const newName = await vscode.window.showInputBox({ prompt: 'Nombre del backup', value: selected.meta.label });
            if (!newName) break;
            const m2 = getBackupMeta(orgId, metaInfo.type, metaInfo.name);
            const entry = m2.find(x => x.timestamp === selected.meta.timestamp);
            if (entry) { entry.label = newName; await saveBackupMeta(orgId, metaInfo.type, metaInfo.name, m2); }
            vscode.window.showInformationMessage(`SF Tools: Backup renombrado a "${newName}".`);
            break;
        }
        case 'lock': {
            const m2 = getBackupMeta(orgId, metaInfo.type, metaInfo.name);
            const entry = m2.find(x => x.timestamp === selected.meta.timestamp);
            if (entry) { entry.locked = !entry.locked; await saveBackupMeta(orgId, metaInfo.type, metaInfo.name, m2); }
            vscode.window.showInformationMessage(`SF Tools: Backup ${selected.meta.locked ? 'desbloqueado' : '🔒 bloqueado'}.`);
            break;
        }
        case 'delete': {
            if (selected.meta.locked) { vscode.window.showWarningMessage('SF Tools: Backup bloqueado. Desbloquéalo primero.'); break; }
            const m2 = getBackupMeta(orgId, metaInfo.type, metaInfo.name);
            const idx = m2.findIndex(x => x.timestamp === selected.meta.timestamp);
            if (idx !== -1) {
                try { await vscode.workspace.fs.delete(vscode.Uri.file(selected.meta.dir), { recursive: true }); } catch {}
                m2.splice(idx, 1);
                await saveBackupMeta(orgId, metaInfo.type, metaInfo.name, m2);
            }
            vscode.window.showInformationMessage('SF Tools: Backup eliminado.');
            break;
        }
    }
}

// ============================================================
// COMPARACIÓN DE ENTORNOS (git branches)
// ============================================================

function runGitCommand(args, cwd) {
    return new Promise((resolve) => {
        execFile('git', args, { cwd: cwd || getWorkspaceRoot(), timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout, stderr) => resolve({ stdout: stdout || '', stderr: stderr || '', code: err?.code ?? 0 })
        );
    });
}

function getEnvBranches() {
    const cfg = vscode.workspace.getConfiguration('sf-tools.environments');
    return [
        { label: 'DEV',     description: `rama: ${cfg.get('dev', 'dev')}`,         branch: cfg.get('dev', 'dev') },
        { label: 'PRE',     description: `rama: ${cfg.get('pre', 'pre')}`,         branch: cfg.get('pre', 'pre') },
        { label: 'PREPROD', description: `rama: ${cfg.get('preprod', 'preprod')}`, branch: cfg.get('preprod', 'preprod') },
        { label: 'PROD',    description: `rama: ${cfg.get('prod', 'main')}`,       branch: cfg.get('prod', 'main') }
    ];
}

async function getFileFromBranch(branch, relativePath, cwd) {
    const res = await runGitCommand(['show', `${branch}:${relativePath}`], cwd);
    return res.code === 0 ? res.stdout : null;
}

async function showEnvFileDiff(relativePath, env1, env2, cwd) {
    const [content1, content2] = await Promise.all([
        getFileFromBranch(env1.branch, relativePath, cwd),
        getFileFromBranch(env2.branch, relativePath, cwd)
    ]);

    if (content1 === null && content2 === null) {
        vscode.window.showWarningMessage(`SF Tools: "${relativePath}" no existe en ninguna de las dos ramas.`);
        return;
    }

    const tmpDir = path.join(os.tmpdir(), 'sf-tools-envdiff');
    const name = path.basename(relativePath);
    const file1 = path.join(tmpDir, `${env1.label}__${name}`);
    const file2 = path.join(tmpDir, `${env2.label}__${name}`);

    try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir)); } catch {}
    await vscode.workspace.fs.writeFile(vscode.Uri.file(file1), Buffer.from(content1 ?? '(archivo no existe en esta rama)', 'utf8'));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(file2), Buffer.from(content2 ?? '(archivo no existe en esta rama)', 'utf8'));

    await vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(file1),
        vscode.Uri.file(file2),
        `${name} — ${env1.label} (${env1.branch}) ↔ ${env2.label} (${env2.branch})`
    );
}

async function pickTwoEnvironments() {
    const envs = getEnvBranches();
    const env1 = await vscode.window.showQuickPick(envs, { placeHolder: 'Selecciona el PRIMER entorno' });
    if (!env1) return null;
    const env2 = await vscode.window.showQuickPick(envs.filter(e => e.label !== env1.label), { placeHolder: 'Selecciona el SEGUNDO entorno' });
    if (!env2) return null;
    return { env1, env2 };
}

async function cmdCompareEnvironments() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('SF Tools: Abre el archivo que quieres comparar entre entornos.'); return; }

    const pair = await pickTwoEnvironments();
    if (!pair) return;

    const cwd = getWorkspaceRoot();
    const relativePath = path.relative(cwd, editor.document.fileName).replace(/\\/g, '/');

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Tools: Comparando ${pair.env1.label} ↔ ${pair.env2.label}...` },
        () => showEnvFileDiff(relativePath, pair.env1, pair.env2, cwd)
    );
}

async function cmdListEnvDiffs() {
    const pair = await pickTwoEnvironments();
    if (!pair) return;

    const cwd = getWorkspaceRoot();

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `SF Tools: Buscando diferencias ${pair.env1.label} ↔ ${pair.env2.label}...` },
        async () => {
            // Buscar diferencias en force-app/ (Salesforce metadata)
            const res = await runGitCommand(
                ['diff', '--name-only', `${pair.env1.branch}...${pair.env2.branch}`, '--', 'force-app/'],
                cwd
            );

            if (res.code !== 0) {
                vscode.window.showErrorMessage(
                    `SF Tools: Error al comparar ramas. ¿Existen "${pair.env1.branch}" y "${pair.env2.branch}" en el repositorio local? Asegúrate de hacer git fetch primero.`
                );
                return;
            }

            const files = res.stdout.trim().split('\n').filter(Boolean);
            if (!files.length) {
                vscode.window.showInformationMessage(
                    `SF Tools: ✅ No hay diferencias en force-app/ entre ${pair.env1.label} y ${pair.env2.label}.`
                );
                return;
            }

            // Agrupar por tipo de metadata
            const grouped = {};
            for (const f of files) {
                const parts = f.split('/');
                const typeFolder = parts[3] || 'otros'; // force-app/main/default/{type}/...
                if (!grouped[typeFolder]) grouped[typeFolder] = [];
                grouped[typeFolder].push(f);
            }

            const items = files.map(f => ({
                label: `$(diff)  ${path.basename(f)}`,
                description: path.dirname(f),
                detail: undefined,
                relativePath: f
            }));

            // Cabecera informativa
            const header = {
                label: `$(info)  ${files.length} archivo(s) diferente(s) entre ${pair.env1.label} y ${pair.env2.label}`,
                description: 'Selecciona uno para ver el diff',
                kind: vscode.QuickPickItemKind.Separator
            };

            const selected = await vscode.window.showQuickPick([header, ...items], {
                placeHolder: `${pair.env1.label} ↔ ${pair.env2.label} — elige un archivo para ver las diferencias`,
                matchOnDescription: true
            });

            if (selected && selected.relativePath) {
                await showEnvFileDiff(selected.relativePath, pair.env1, pair.env2, cwd);
            }
        }
    );
}

async function cmdViewSyncStatus() {
    const orgInfo = await getCurrentOrgInfo();
    if (!orgInfo) { vscode.window.showErrorMessage('SF Tools: No se pudo obtener info de la org.'); return; }
    const orgId = orgInfo.id || orgInfo.alias || 'default';
    const prefix = `sftools_ret_${orgId}_`;
    const allKeys = (_ctx.workspaceState.get(KEY_IDX, [])).filter(k => k.startsWith(prefix));

    if (!allKeys.length) {
        vscode.window.showInformationMessage('SF Tools: No hay archivos trackeados. Usa "Tracked Retrieve" para empezar.');
        return;
    }

    const items = allKeys.map(k => {
        const rest = k.replace(prefix, '');
        const underscoreIdx = rest.indexOf('_');
        const type = rest.slice(0, underscoreIdx);
        const name = rest.slice(underscoreIdx + 1);
        const ts = _ctx.workspaceState.get(k);
        return { label: name, description: type, detail: ts ? `Último retrieve: ${getTimeAgo(ts)}  (${new Date(ts).toLocaleString()})` : 'Sin timestamp', key: k };
    });

    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Archivos trackeados con SF Tools' });
    if (!selected) return;

    const action = await vscode.window.showQuickPick([
        { label: '$(trash) Limpiar timestamp de este archivo', value: 'one' },
        { label: '$(clear-all) Limpiar todos los timestamps', value: 'all' }
    ], { placeHolder: 'Acción' });
    if (!action) return;

    if (action.value === 'one') {
        await clearRetrieveTimestamp(selected.key);
        vscode.window.showInformationMessage(`SF Tools: Timestamp de ${selected.label} eliminado.`);
    } else {
        for (const k of allKeys) await clearRetrieveTimestamp(k);
        vscode.window.showInformationMessage('SF Tools: Todos los timestamps eliminados.');
    }
}
