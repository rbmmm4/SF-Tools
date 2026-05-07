# SF Tools — Salesforce Developer Toolkit

**[English]** A VS Code extension built for Salesforce developers that automates the most repetitive formatting and code quality tasks in Apex, LWC, Aura, and Visualforce.

**[Español]** Extensión de VS Code para desarrolladores Salesforce que automatiza las tareas de formato y calidad de código más repetitivas en Apex, LWC, Aura y Visualforce.

---

## Features at a Glance / Resumen de funciones

| # | Feature / Función | Shortcut |
|---|---------|----------|
| 1 | **Run All** — one configurable shortcut for everything / un atajo configurable para todo | `Ctrl+Shift+Alt+F` |
| 2 | **Expand If Blocks** — adds `{ }` to single-line ifs / añade llaves a ifs de una línea | `Ctrl+Shift+Alt+I` |
| 3 | **Collapse SOQL** — keeps queries on one line / mantiene queries en una línea | `Ctrl+Shift+Alt+S` |
| 4 | **Collapse HTML Attributes** — one tag per line / colapsa tags multilínea | `Ctrl+Shift+Alt+H` |
| 5 | **Collapse @isTest Methods** — hides test code / oculta métodos de test | `Ctrl+Shift+Alt+T` |
| 6 | **Extract to Custom Label** — right-click → label + XML + deploy / clic derecho → label + XML + deploy | Right-click menu |
| 7 | **Complexity Metrics** — live CC, COG, LOC, Params, nesting depth per line / métricas en vivo | Automatic / Automático |
| 8 | **Ctrl+Click Navigation** — apex import → class/method, component tag → JS / navegación a clase, método o componente | Automatic / Automático |
| 9 | **LWC Import Validator** — detects missing/unused Apex imports in real time / detecta imports ausentes en tiempo real | Automatic / Automático |
| 10 | **Deployment Guard** — conflict detection, versioned backups, diff viewer, safe deploy & retrieve / detección de conflictos, backups con versiones, deploy seguro | `Ctrl+Shift+Alt+D` / `R` |
| 11 | **Right-click menu** — all actions in one submenu / todas las acciones en un submenú de clic derecho | Right-click |
| 12 | **Environment comparison** — diff any file or list all changes between DEV/PRE/PREPROD/PROD git branches, no org needed / compara entornos via git sin conectarse a ninguna org | Right-click / Command Palette |

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

**What it does / Qué hace:**
1. Prompts you to confirm or edit the API name (auto-generated from your selection) / Pide confirmar o editar el API name (generado automáticamente del texto seleccionado)
2. Replaces the selected text with the correct label reference for your file type / Reemplaza el texto seleccionado con la referencia correcta según el tipo de archivo
3. Creates or updates `force-app/main/default/labels/CustomLabels.labels-meta.xml` / Crea o actualiza el XML de Custom Labels
4. **Automatically opens the XML file** beside your editor so you can review the result / **Abre el XML automáticamente** al lado de tu editor para que puedas revisarlo
5. Asks if you want to **deploy immediately** — if yes, opens a terminal and runs `sf project deploy start` / Pregunta si quieres **hacer deploy inmediatamente** — si dices que sí, abre un terminal y ejecuta el deploy

> Requires Salesforce CLI (`sf`) installed and an authorized org. / Requiere Salesforce CLI (`sf`) instalado y una org autorizada.

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

## All Commands Reference / Referencia completa de comandos

Open the Command Palette (`Ctrl+Shift+P`) and search "SF Tools" / Abre la paleta de comandos y busca "SF Tools":

### Formato / Formatting
| Comando | Shortcut | Descripción |
|---------|----------|-------------|
| `SF Tools: Format All` | `Ctrl+Shift+Alt+F` | Ejecuta todas las operaciones activas (Run All) |
| `SF Tools: Expand If Blocks` | `Ctrl+Shift+Alt+I` | Añade llaves a ifs de una línea |
| `SF Tools: Colapsar SOQL a una línea` | `Ctrl+Shift+Alt+S` | Colapsa queries SOQL multilínea |
| `SF Tools: Colapsar atributos HTML a una línea` | `Ctrl+Shift+Alt+H` | Colapsa tags Aura/LWC/VF multilínea |
| `SF Tools: Colapsar métodos @isTest` | `Ctrl+Shift+Alt+T` | Colapsa todos los métodos @isTest |

### Calidad de código / Code quality
| Comando | Descripción |
|---------|-------------|
| `SF Tools: Activar/Desactivar complejidad ciclomática` | Muestra/oculta todas las métricas de complejidad |
| `SF Tools: Validar imports de Apex en LWC` | Fuerza validación de imports en el archivo LWC actual |

### Custom Labels
| Comando | Descripción |
|---------|-------------|
| `SF Tools: Extraer a Custom Label` | Convierte texto seleccionado en Custom Label (también en clic derecho) |

### Navegación / Navigation
| Comando | Descripción |
|---------|-------------|
| Ctrl+Click en clase/método Apex | Navega a la definición (ver sección 8) |
| Ctrl+Click en tag `<c-componente>` | Abre el JS del componente LWC |

### Deployment Guard
| Comando | Shortcut | Descripción |
|---------|----------|-------------|
| `SF Tools: Safe Deploy` | `Ctrl+Shift+Alt+D` | Detecta conflictos y deploya con protección |
| `SF Tools: Tracked Retrieve` | `Ctrl+Shift+Alt+R` | Recupera desde org y guarda timestamp |
| `SF Tools: Crear Backup del archivo actual` | — | Backup inmediato sin deployar |
| `SF Tools: Gestionar Backups` | — | Comparar, restaurar, renombrar, bloquear/eliminar versiones |
| `SF Tools: Activar/Desactivar backup automático para este archivo` | — | Toggle backup automático por archivo |
| `SF Tools: Ver estado de sync de archivos trackeados` | — | Lista archivos trackeados con sus timestamps de retrieve |

### Comparación de entornos / Environment comparison
| Comando | Descripción |
|---------|-------------|
| `SF Tools: Comparar entornos (git branches)` | Diff del archivo actual entre dos ramas git (ninguna es la local) |
| `SF Tools: Ver todos los archivos diferentes entre entornos` | Lista completa de archivos que difieren entre dos ramas |
| `SF Tools: Comparar entorno vs archivo local actual` | Diff del archivo local actual vs una rama git — lado derecho editable para mergear |
| `SF Tools: Ver todos los archivos diferentes entre entorno y local` | Lista de archivos que difieren entre tu rama local actual y un entorno |

### Ayuda / Help
| Comando | Descripción |
|---------|-------------|
| `SF Tools: Ayuda — Ver todas las funciones` | Abre panel con documentación interactiva y colapsable |

---

## 8. Ctrl+Click Navigation / Navegación con Ctrl+Click

**EN:** Non-invasive Go-to-Definition providers that only activate in gaps not covered by the Salesforce Extension Pack.
**ES:** Proveedores de navegación no invasivos que solo se activan en los huecos que el Salesforce Extension Pack no cubre.

### From Apex `.cls` — 3 cases / Desde Apex `.cls` — 3 casos

**Case A / Caso A:** Method call on another class / Llamada a método de otra clase
```apex
AccountController.getAccountList(params);
// ↑ Ctrl+Click en "AccountController" → abre AccountController.cls (top)
//                  ↑ Ctrl+Click en "getAccountList" → salta al método exacto en AccountController.cls
```

**Case B / Caso B:** Class reference as a type / Referencia a una clase como tipo
```apex
MyCustomWrapper wrapper = new MyCustomWrapper();
// ↑ Ctrl+Click en "MyCustomWrapper" → abre MyCustomWrapper.cls
```

**Case C / Caso C:** Method call in the same class / Llamada a método en la misma clase
```apex
this.calcularDescuento(orden);
// ↑ Ctrl+Click en "calcularDescuento" → salta a la definición en el mismo archivo
```

---

### From LWC JS — `@salesforce/apex` imports

```javascript
import getAccountList from '@salesforce/apex/AccountController.getAccountList';
//                                            ↑ Ctrl+Click → opens AccountController.cls
//                                                           ↑ Ctrl+Click → jumps to getAccountList method
```

### From LWC HTML — component tags / Desde LWC HTML — tags de componente

```html
<c-invoice-card record-id={recordId}></c-invoice-card>
<!-- ↑ Ctrl+Click on "invoice-card" → opens lwc/invoiceCard/invoiceCard.js -->
```

Converts kebab-case to camelCase and finds the component in your project. / Convierte kebab-case a camelCase y encuentra el componente en tu proyecto.

**Toggle off / Desactivar:** Settings → `sf-tools.enableNavigation` → false

---

## 9. LWC Import Validator — Automatic / Automático

**EN:** Runs automatically every time you open or edit a LWC `.js` file. Detects three types of problems and shows them in the **Problems panel** (`Ctrl+Shift+M`):

**ES:** Se ejecuta automáticamente cada vez que abres o editas un archivo `.js` de LWC. Detecta tres tipos de problemas y los muestra en el **panel Problems** (`Ctrl+Shift+M`):

---

### ❌ Error — `@wire` call without import / `@wire` sin import

```javascript
// Missing: import getAccountList from '@salesforce/apex/AccountController.getAccountList';

@wire(getAccountList, { recordId: '$recordId' })   // ← Error: 'getAccountList' sin import
wiredAccounts({ data, error }) { ... }
```

---

### ⚠️ Warning — Imperative Apex call without import / Llamada imperativa sin import

```javascript
// Missing: import saveRecord from '@salesforce/apex/AccountController.saveRecord';

saveRecord({ record: this.account })   // ← Warning: parece Apex pero no tiene import
    .then(result => { ... });
```

---

### ⚠️ Warning — Unused Apex import / Import de Apex sin usar

```javascript
import getContacts from '@salesforce/apex/ContactController.getContacts';
// ← Warning: 'getContacts' está importado pero no se usa en ningún @wire ni llamada
```

---

Trigger manually at any time with `Ctrl+Shift+P` → **SF Tools: Validar imports de Apex en LWC**.

Ejecuta manualmente cuando quieras con `Ctrl+Shift+P` → **SF Tools: Validar imports de Apex en LWC**.

---

## 10. Deployment Guard — Safe Deploy, Backups & Conflict Detection

**EN:** Protects you from accidentally overwriting changes made by other developers in the org. Detects conflicts before deploying, creates versioned backups, and lets you visually compare local vs org versions.

**ES:** Te protege de sobreescribir accidentalmente cambios que otros desarrolladores han hecho en la org. Detecta conflictos antes de deployar, crea backups con versiones y te permite comparar visualmente tu versión local con la de la org.

> Requires Salesforce CLI (`sf`) installed and an active org session (`sf org login`). / Requiere Salesforce CLI (`sf`) instalado y sesión activa.

---

### 10.1 Safe Deploy — `Ctrl+Shift+Alt+D`

**EN:** Before deploying, checks if someone else modified the file in the org since your last retrieve. If a conflict is detected, you can view the diff before deciding.

**ES:** Antes de deployar, comprueba si alguien modificó el archivo en la org desde tu último retrieve. Si hay conflicto, puedes ver las diferencias antes de decidir.

**Flow / Flujo:**
```
Safe Deploy →
  1. Conecta con la org y consulta LastModifiedDate del componente
  2. Compara con tu timestamp local de último retrieve
  3a. Sin conflicto → [backup opcional] → deploy → guarda nuevo timestamp
  3b. Con conflicto → muestra aviso con quién lo cambió y cuándo →
        "Ver diferencias" → abre diff Org ↔ Local en VS Code
        "Deploy igualmente" → fuerza el deploy
        "Cancelar" → no hace nada
```

**Supported metadata / Metadata soportada:**
`ApexClass`, `ApexTrigger`, `LightningComponentBundle`, `AuraDefinitionBundle`, `ApexPage`, `ApexComponent`, `Flow`

---

### 10.2 Tracked Retrieve — `Ctrl+Shift+Alt+R`

**EN:** Retrieves the file from the org AND saves a timestamp. This timestamp is used by Safe Deploy to detect future conflicts. Always use this instead of a plain retrieve when working with SF Tools.

**ES:** Recupera el archivo desde la org Y guarda un timestamp. Safe Deploy usa ese timestamp para detectar futuros conflictos. Úsalo siempre en lugar de un retrieve normal cuando trabajes con SF Tools.

```
Tracked Retrieve →
  1. [Backup opcional si está activado para este archivo]
  2. sf project retrieve start --source-dir <archivo>
  3. Guarda timestamp del retrieve
```

---

### 10.3 Crear Backup — Command Palette

Crea un backup inmediato del archivo actual sin deployar. Los backups se guardan en `.sf-tools-backups/{orgAlias}/{tipo}/{nombre}/{timestamp}/`.

---

### 10.4 Gestionar Backups — Command Palette

Muestra todos los backups de un archivo y permite:

| Acción | Descripción |
|--------|-------------|
| **Comparar** | Abre diff: versión del backup ↔ versión local actual |
| **Restaurar** | Reemplaza el archivo actual por el backup (guarda el estado actual como nuevo backup antes) |
| **Renombrar** | Asigna un nombre descriptivo al backup (ej: "Antes de refactor login") |
| **Bloquear / Desbloquear** | Los backups bloqueados 🔒 no se eliminan automáticamente aunque se supere el máximo |
| **Eliminar** | Borra el backup (no disponible si está bloqueado) |

**Máximo de backups por archivo:** 5 (configurable). Los desbloqueados más antiguos se eliminan solos.

---

### 10.5 Activar/Desactivar Backup Automático — Command Palette

Activa o desactiva la creación automática de backup para el archivo actual cada vez que hagas un Tracked Retrieve.

```
sf-tools.toggleBackup → toggle ON/OFF para el archivo activo
```

---

### 10.6 Ver Estado de Sync — Command Palette

Muestra todos los archivos que SF Tools está trackeando con sus timestamps de último retrieve. Desde aquí puedes limpiar timestamps individuales o todos a la vez.

```
AccountController  ApexClass  Último retrieve: hace 2h (07/05/2026, 10:32:14)
InvoiceService     ApexClass  Último retrieve: hace 5d (02/05/2026, 16:45:00)
invoiceCard        LWC        Último retrieve: hace 1h (07/05/2026, 11:15:43)
```

---

### Deployment Guard — Settings

| Setting | Default | Descripción |
|---------|---------|-------------|
| `sf-tools.deployGuard.autoBackupOnDeploy` | `true` | Crear backup antes de cada Safe Deploy |
| `sf-tools.deployGuard.maxBackupsPerFile` | `5` | Máximo de backups por archivo (los desbloqueados más antiguos se eliminan) |

---

### Deployment Guard — Shortcuts

| Shortcut | Comando |
|----------|---------|
| `Ctrl+Shift+Alt+D` | Safe Deploy |
| `Ctrl+Shift+Alt+R` | Tracked Retrieve |
| `Ctrl+Shift+P` → Crear Backup | Backup manual |
| `Ctrl+Shift+P` → Gestionar Backups | Ver/comparar/restaurar backups |
| `Ctrl+Shift+P` → Ver estado de sync | Ver archivos trackeados |

---

## 11. Menú contextual — Clic derecho / Right-click menu

**EN:** All main SF Tools actions are available from a single right-click submenu. No need to remember shortcuts.
**ES:** Todas las acciones principales de SF Tools están disponibles desde un único submenú de clic derecho. No hace falta recordar atajos.

Right-click anywhere in the editor → **SF Tools** → submenu expands:

```
SF Tools ▶
  ├── Safe Deploy — detectar conflictos y deployar
  ├── Tracked Retrieve — recuperar y guardar timestamp
  ├── Format All (expandir ifs + indentar)
  ├── ──────────────────────────────────────
  ├── Crear Backup del archivo actual
  ├── Gestionar Backups — comparar, restaurar, renombrar
  ├── Activar/Desactivar backup automático
  ├── ──────────────────────────────────────
  ├── Comparar entornos (git branches)
  ├── Ver todos los archivos diferentes entre entornos
  ├── ──────────────────────────────────────
  ├── Extraer a Custom Label  (solo si hay texto seleccionado)
  ├── Expand If Blocks
  └── Ver estado de sync de archivos trackeados
```

> **Note / Nota:** "Safe Deploy" is NOT the same as `sf project deploy start` from the CLI. The CLI deploy bypasses conflict detection. Always use SF Tools Safe Deploy when you want protection against overwrites. / "Safe Deploy" NO es lo mismo que `sf project deploy start` desde el CLI. El CLI bypasea la detección de conflictos. Usa siempre SF Tools Safe Deploy cuando quieras protección.

---

## 12. Comparación de entornos (DEV / PRE / PREPROD / PROD)

**EN:** Designed for teams where direct org access is only available to one environment (e.g. DEV via CLI) and the rest are promoted through git branches. Compares Salesforce metadata between any two environment branches — **no org connection needed, works entirely with the local git repository**.

**ES:** Diseñado para equipos donde solo se tiene acceso directo por CLI a un entorno (por ejemplo DEV) y el resto se gestiona por ramas git. Compara metadata de Salesforce entre cualquier par de entornos — **sin necesitar conexión a ninguna org, funciona con el repositorio git local**.

---

### Configuración de ramas / Branch configuration

Go to **Settings → SF Tools → Environments** and set your branch names:

| Setting | Default | Description |
|---------|---------|-------------|
| `sf-tools.environments.dev`     | `dev`     | Rama git del entorno DEV |
| `sf-tools.environments.pre`     | `pre`     | Rama git del entorno PRE |
| `sf-tools.environments.preprod` | `preprod` | Rama git del entorno PREPROD |
| `sf-tools.environments.prod`    | `main`    | Rama git del entorno PROD |

> **Importante / Important:** Las ramas deben existir en tu repositorio local. Haz `git fetch --all` antes de usar esta función para tener las ramas actualizadas. / Branches must exist locally. Run `git fetch --all` first to have up-to-date branches.

---

### Comparar archivo actual entre dos entornos

`Ctrl+Shift+P` → **SF Tools: Comparar entornos** / Right-click → SF Tools → Comparar entornos

1. Selecciona el primer entorno (DEV / PRE / PREPROD / PROD)
2. Selecciona el segundo entorno
3. Se abre el **diff viewer de VS Code** con el archivo actual comparado entre las dos ramas

```
AccountController.cls — PRE (pre) ↔ PREPROD (preprod)
┌─────────────────────────────────────────────────────┐
│ PRE                    │ PREPROD                    │
│ public void process() {│ public void process() {    │
│   if(x == null)        │   if(x == null) {          │
│     return;            │       return;              │
│                        │   }                        │
└─────────────────────────────────────────────────────┘
```

---

### Ver todos los archivos diferentes entre dos entornos

`Ctrl+Shift+P` → **SF Tools: Ver todos los archivos diferentes entre entornos** / Right-click → SF Tools → Ver todos los archivos diferentes

1. Selecciona los dos entornos
2. SF Tools ejecuta `git diff --name-only branch1...branch2 -- force-app/`
3. Muestra la lista de todos los archivos de metadata que difieren
4. Selecciona cualquiera para ver su diff inmediatamente

**Ejemplo de resultado / Example output:**
```
$(info) 7 archivo(s) diferentes entre PRE y PREPROD

AccountController.cls          force-app/main/default/classes
InvoiceService.cls             force-app/main/default/classes
invoiceCard.js                 force-app/main/default/lwc/invoiceCard
invoiceCard.html               force-app/main/default/lwc/invoiceCard
CustomLabels.labels-meta.xml   force-app/main/default/labels
OrderFlow.flow-meta.xml        force-app/main/default/flows
MyObject__c.object-meta.xml    force-app/main/default/objects
```

---

### Flujo de trabajo recomendado / Recommended workflow

```
1. Trabajas en DEV → usas Safe Deploy y Tracked Retrieve con CLI
2. Abres PR dev → pre
3. Antes de hacer la PR: Ctrl+P → "Ver todos los archivos diferentes"
   → Seleccionas DEV ↔ PRE para ver qué cambia
4. PR mergeada → pre → preprod
5. Mismo proceso: comparas PRE ↔ PREPROD para verificar
6. Antes de PROD: comparas PREPROD ↔ PROD para validar
```

Nunca necesitas conectarte a PRE, PREPROD ni PROD. Todo se hace con git local.

---

## Requirements / Requisitos

- VS Code 1.85.0 or higher
- Salesforce Extension Pack (for Apex formatting in Run All)
- A `force-app/main/default/` project structure (for Custom Label extraction)

---

## Release Notes

### 1.0.0
Initial release with all core features: if-block expansion, SOQL collapser, HTML collapser, @isTest folder, Custom Label extractor, and live complexity metrics (CC, COG, LOC, Params, Depth).
