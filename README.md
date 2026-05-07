# SF Tools — Salesforce Developer Toolkit

**[English]** A VS Code extension built for Salesforce developers that automates the most repetitive formatting and code quality tasks in Apex, LWC, Aura, and Visualforce.

**[Español]** Extensión de VS Code para desarrolladores Salesforce que automatiza las tareas de formato y calidad de código más repetitivas en Apex, LWC, Aura y Visualforce.

---

## Features at a Glance

| # | Feature | Shortcut |
|---|---------|----------|
| 1 | **Run All** — one command to rule them all | `Ctrl+Shift+Alt+F` |
| 2 | **Expand If Blocks** — adds `{ }` to single-line ifs | `Ctrl+Shift+Alt+I` |
| 3 | **Collapse SOQL** — keeps queries on one line | `Ctrl+Shift+Alt+S` |
| 4 | **Collapse HTML Attributes** — one tag per line | `Ctrl+Shift+Alt+H` |
| 5 | **Collapse @isTest Methods** — hides test code | `Ctrl+Shift+Alt+T` |
| 6 | **Extract to Custom Label** — right-click any selected text | Right-click menu |
| 7 | **Complexity Metrics** — live per-method stats in the editor | Automatic |

---

## 1. Run All — `Ctrl+Shift+Alt+F`

One shortcut that runs all the formatting operations you have enabled in Settings.

Go to **Settings → SF Tools → Run All** and check/uncheck what you want:

- `sf-tools.runAll.expandIfs` — expand single-line if blocks *(default: ON)*
- `sf-tools.runAll.formatDocument` — indent the full document *(default: ON)*
- `sf-tools.runAll.collapseSoql` — collapse multiline SOQL *(default: ON)*
- `sf-tools.runAll.collapseHtml` — collapse multiline HTML tags *(default: OFF)*
- `sf-tools.runAll.collapseTests` — fold @isTest methods *(default: OFF)*

If nothing is checked, the command will warn you and do nothing.

---

## 2. Expand If Blocks — `Ctrl+Shift+Alt+I`

Converts single-line `if` statements (without braces) to proper block form. Required by most Apex PMD rulesets (`IfStmtsMustUseBraces`).

**Before:**
```apex
if(account == null) return;
if(contact.Email == null) throw new CustomException('No email');
```

**After:**
```apex
if(account == null) {
    return;
}
if(contact.Email == null) {
    throw new CustomException('No email');
}
```

Also handles `else if` and `else` chains. Does NOT touch lines that already have braces or are inside comments.

**Auto-expand on save:** enable `sf-tools.expandOnSave` in Settings to run this automatically every time you save an Apex or JavaScript file.

---

## 3. Collapse SOQL to One Line — `Ctrl+Shift+Alt+S`

Finds bracket SOQL queries (`[SELECT ... FROM ...]`) written across multiple lines and collapses them to a single line. Useful when a formatter has broken your queries across lines.

**Before:**
```apex
List<Account> accs = [
    SELECT Id, Name, Phone
    FROM Account
    WHERE IsActive = true
    LIMIT 100
];
```

**After:**
```apex
List<Account> accs = [SELECT Id, Name, Phone FROM Account WHERE IsActive = true LIMIT 100];
```

Only affects blocks that contain the `SELECT` keyword — other bracket expressions (like List literals) are left untouched.

---

## 4. Collapse HTML Attributes to One Line — `Ctrl+Shift+Alt+H`

Collapses multiline HTML tags (Aura components, LWC templates, Visualforce pages) to a single line per tag. Useful for diff readability and PMD rules that require one-line tags.

**Before:**
```html
<lightning:input aura:id="callIdInput"
                 label="ID de llamada"
                 value="{!v.callId}"
                 required="true"
                 placeholder="Ej: 12345678" />
```

**After:**
```html
<lightning:input aura:id="callIdInput" label="ID de llamada" value="{!v.callId}" required="true" placeholder="Ej: 12345678" />
```

Handles quoted attribute values correctly — spaces inside quotes are preserved.

---

## 5. Collapse @isTest Methods — `Ctrl+Shift+Alt+T`

Finds all methods annotated with `@isTest` in an Apex class and folds them in the editor. This lets you see only the production code without closing the file.

```apex
@isTest
static void testProcessOrder() {   // ← this entire method gets folded
    ...
}
```

To unfold, use VS Code's standard **Unfold All** (`Ctrl+K Ctrl+J`) or click the fold arrow in the gutter.

---

## 6. Extract to Custom Label — Right-click menu

Select any hardcoded string in Apex, LWC, Aura, or Visualforce → right-click → **SF Tools: Extraer a Custom Label**.

**What it does:**
1. Prompts you to confirm or edit the API name (auto-generated from your selection)
2. Replaces the selected text with the correct label reference for your file type
3. Creates or updates `force-app/main/default/labels/CustomLabels.labels-meta.xml`
4. Offers to open the XML file so you can review it

**Replacement format by file type:**

| File type | Replacement |
|-----------|-------------|
| Apex `.cls` | `Label.My_Label` |
| LWC `.html` | `{label.My_Label}` |
| Aura / Visualforce | `{!$Label.c.My_Label}` |

**Generated XML entry** (ready to deploy with `sf project deploy start`):
```xml
<labels>
    <fullName>My_Label</fullName>
    <language>es</language>
    <protected>false</protected>
    <shortDescription>My_Label</shortDescription>
    <value>Original selected text</value>
</labels>
```

If the label already exists in the XML, the command warns you instead of creating a duplicate.

---

## 7. Complexity Metrics — Automatic (Apex only)

SF Tools automatically shows complexity metrics at the end of each method signature in any open `.cls` file. No action needed — they update as you type (with a short debounce).

**Color coding** (based on Cyclomatic Complexity):
- **Green** — CC ≤ 5 → simple, easy to test
- **Orange** — CC 6–10 → moderate, consider refactoring
- **Red** — CC > 10 → high risk, hard to test, refactor recommended

**Example display:**
```apex
public void processOrder(Order o, Boolean recalc) {    CC:4 · COG:6 · LOC:18 · Params:2 · Depth:3
```

### Available metrics (configure in Settings → SF Tools → Complexity):

| Metric | Key | Default | Description |
|--------|-----|---------|-------------|
| **CC** — Cyclomatic Complexity | `sf-tools.complexity.cyclomatic` | ON | Counts decision points: `if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, ternary. Base score is 1. |
| **COG** — Cognitive Complexity | `sf-tools.complexity.cognitive` | ON | Like cyclomatic, but adds extra weight for each nesting level. A deeply nested `if` scores higher than a top-level one. Better reflects how hard code actually is to read. |
| **LOC** — Lines of Code | `sf-tools.complexity.loc` | OFF | Non-empty, non-comment lines in the method body. Methods over 30 LOC are usually candidates for extraction. |
| **Params** — Parameter count | `sf-tools.complexity.params` | OFF | Number of method parameters. More than 4 parameters usually signals the method is doing too much. |
| **Depth** — Nesting per line | `sf-tools.complexity.nesting` | OFF | Shows the nesting depth directly on each `if`, `for`, `while` and `else` line that opens a block. Green ≤ 1, orange 2–3, red ≥ 4. Points exactly to the problematic line instead of showing just the max for the whole method. / Muestra la profundidad de anidamiento directamente en cada línea `if`, `for`, `while`, `else` que abre un bloque. Verde ≤ 1, naranja 2–3, rojo ≥ 4. Señala exactamente la línea problemática en vez de mostrar solo el máximo del método. |

To **hide all metrics**, uncheck `sf-tools.showComplexity` in Settings or run `Ctrl+Shift+P` → **SF Tools: Activar/Desactivar complejidad ciclomática**.

---

## All Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `sf-tools.expandOnSave` | boolean | `true` | Auto-expand if blocks on save (Apex + JS) |
| `sf-tools.showComplexity` | boolean | `true` | Show/hide all complexity metrics |
| `sf-tools.complexity.cyclomatic` | boolean | `true` | Show Cyclomatic Complexity (CC) |
| `sf-tools.complexity.cognitive` | boolean | `true` | Show Cognitive Complexity (COG) |
| `sf-tools.complexity.loc` | boolean | `false` | Show Lines of Code (LOC) |
| `sf-tools.complexity.params` | boolean | `false` | Show parameter count (Params) |
| `sf-tools.complexity.nesting` | boolean | `false` | Show max nesting depth (Depth) |
| `sf-tools.runAll.expandIfs` | boolean | `true` | Include if-block expansion in Run All |
| `sf-tools.runAll.formatDocument` | boolean | `true` | Include document formatting in Run All |
| `sf-tools.runAll.collapseSoql` | boolean | `true` | Include SOQL collapse in Run All |
| `sf-tools.runAll.collapseHtml` | boolean | `false` | Include HTML collapse in Run All |
| `sf-tools.runAll.collapseTests` | boolean | `false` | Include @isTest collapse in Run All |

---

## All Commands Reference

Open the Command Palette (`Ctrl+Shift+P`) and search "SF Tools":

| Command | Description |
|---------|-------------|
| `SF Tools: Format All` | Master command — runs all enabled operations |
| `SF Tools: Expand If Blocks` | Add braces to single-line if statements |
| `SF Tools: Colapsar SOQL a una línea` | Collapse multiline bracket SOQL to one line |
| `SF Tools: Colapsar atributos HTML a una línea` | Collapse multiline HTML tags to one line |
| `SF Tools: Colapsar métodos @isTest` | Fold all @isTest methods in current file |
| `SF Tools: Extraer a Custom Label` | Convert selected text to a Custom Label |
| `SF Tools: Activar/Desactivar complejidad ciclomática` | Toggle all complexity metrics on/off |

---

## Requirements

- VS Code 1.85.0 or higher
- Salesforce Extension Pack (for Apex formatting in Run All)
- A `force-app/main/default/` project structure (for Custom Label extraction)

---

## Release Notes

### 1.0.0
Initial release with all core features: if-block expansion, SOQL collapser, HTML collapser, @isTest folder, Custom Label extractor, and live complexity metrics (CC, COG, LOC, Params, Depth).
