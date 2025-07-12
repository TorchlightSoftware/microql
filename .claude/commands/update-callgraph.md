# Instructions for Updating MicroQL Call Graph

This document provides step-by-step instructions for maintaining the `microql-callgraph.gv` file when functions are added, removed, or modified in the MicroQL codebase.

## When to Update

Update the call graph when:
- New functions are added to any `.js` file in the MicroQL directory
- Functions are removed or renamed
- Function call relationships change (new calls added, calls removed)
- Cross-file dependencies change (imports/exports modified)

## Step-by-Step Process

### 1. Identify All Functions in the Codebase

First, get a complete list of all functions:

```bash
# Find all const arrow functions
rg "^const.*=.*=>" --type js

# Find all traditional function declarations  
rg "^function " --type js

# Find all async function declarations
rg "^async function " --type js

# Find all exported functions
rg "^export.*function" --type js
```

### 2. Map Function Callers Systematically

For each function found in step 1, search for all its callers:

```bash
# For each function, find all call sites
rg "functionName\(" --type js

# Get line numbers and context for analysis
rg -n -A 3 -B 3 "functionName\(" --type js
```

**Key functions to always check:**
- `transformMethodSyntax` (frequently called from multiple contexts)
- `executeService` (core execution function)
- `executeServiceCore` (core implementation)
- `executeChain` (chain processing)
- `compileServiceFunction` (service compilation)
- `processParameters` (parameter processing)
- `withErrorHandling` (error wrapper)
- `withOnParameter` (parameter wrapper)
- `deepMerge` (recursive utility)
- `getDependencies` (recursive dependency analysis)

### 3. Analyze Cross-File Dependencies

Check imports and exports between files:

```bash
# Check imports from other MicroQL files
rg "import.*from '\./.*\.js'" --type js

# Check what each file exports
rg "export " --type js
```

**Current cross-file dependencies to verify:**
- `processParameters.js` → `query.js` (processParameters function)
- `executionContext.js` → `query.js` (ExecutionContext class)
- `retrieve.js` → `query.js` (retrieve function)
- `util.js` → `query.js` (utilService, COLOR_NAMES)

### 4. Determine Function Context

For each function call found, determine the containing function:

```bash
# Read the file around the line number to see which function contains the call
# Use the Read tool with offset/limit to examine context
```

**Common patterns to watch for:**
- Multiple call sites within the same function
- Recursive calls (function calling itself)
- Wrapper functions that call the wrapped function
- Error handlers that call service functions

### 5. Update the GraphViz File

#### Function Declarations

Add new functions to the appropriate category:

```dot
// Entry Points (red)
newEntryFunction [label="newEntryFunction()" shape="rect" style="rounded,filled" fillcolor="#D0021B"];

// Core Functions (blue)  
newCoreFunction [label="newCoreFunction()" shape="rect" style="rounded,filled" fillcolor="#4A90E2"];

// Wrapper Functions (green)
newWrapperFunction [label="newWrapperFunction()" shape="rect" style="rounded,filled" fillcolor="#7ED321"];

// Utility Functions (orange)
newUtilFunction [label="newUtilFunction()" shape="rect" style="rounded,filled" fillcolor="#F5A623"];

// External Dependencies (purple)
newExternalFunction [label="newExternalFunction()" shape="rect" style="rounded,filled" fillcolor="#9013FE"];
```

#### Function Relationships

Add all caller → callee relationships:

```dot
// Document multiple call sites with comments
callerFunction -> calleeFunction;  // context comment
callerFunction -> calleeFunction;  // different context comment

// Include recursive calls
recursiveFunction -> recursiveFunction;  // recursive
```

#### File Groupings

Add new functions to the appropriate file cluster:

```dot
subgraph cluster_filename {
    label="File: filename.js";
    style="filled";
    fillcolor="#f0f0f0";
    
    // Add new functions here
    newFunction;
}
```

### 6. Validation Steps

After updating the GraphViz file:

```bash
# Generate the PNG to check for syntax errors
dot -Tpng microql-callgraph.gv -o microql-callgraph.png

# Verify the image was created and looks correct
# Check for:
# - All functions are represented
# - All relationships are shown
# - No missing arrows
# - Proper color coding
# - Readable layout
```

### 7. Common Pitfalls to Avoid

**Missing Multiple Call Sites:**
- Don't just show one arrow per function relationship
- If `functionA` calls `functionB` in 3 different places, show all 3 relationships (even if they look redundant)

**Forgetting Cross-File Dependencies:**
- Always check if functions are called from other files
- Include external dependencies in the External Dependencies cluster

**Incorrect Function Categories:**
- Entry points: Functions called from outside MicroQL (main exports)
- Core functions: Main execution logic (executeService, executeChain, etc.)
- Wrapper functions: Add behavior to other functions (withErrorHandling, withRetry, etc.)
- Utility functions: Helper functions used by multiple other functions
- External dependencies: Functions from other files/modules

**Missing Recursive Patterns:**
- Some functions call themselves (deepMerge, getDependencies)
- Some functions have indirect recursion (withErrorHandling → executeService → withErrorHandling)

### 8. Testing the Update

```bash
# Verify the graph compiles
dot -Tpng microql-callgraph.gv -o microql-callgraph.png

# Check the generated image
# Look for:
# - New functions appear in correct colors
# - All relationships are visible
# - No syntax errors or missing nodes
# - Layout is still readable

# Run MicroQL tests to ensure code still works
npm test
```

### 9. Documentation Notes

When updating, add comments in the GraphViz file explaining:
- Why functions are categorized as they are
- Multiple call sites with context
- Any complex relationships that might be confusing

### 10. Commit the Changes

```bash
git add microql-callgraph.gv microql-callgraph.png
git commit -m "update: refresh MicroQL call graph with [description of changes]"
```

## Function Category Guidelines

**Entry Points (Red):**
- `query()` - Main MicroQL entry point
- `executeQueryInner()` - Internal query execution

**Core Functions (Blue):**
- `executeService()` - Service orchestration
- `executeServiceCore()` - Core service execution
- `executeChain()` - Chain execution
- `guardServiceExecution()` - Service execution guard

**Wrapper Functions (Green):**
- `withErrorHandling()` - Error handling wrapper
- `withRetryWrapper()` - Retry wrapper
- `withTimeoutWrapper()` - Timeout wrapper
- `withGuard()` - Debug guard wrapper
- `withTimeout()` - Timeout implementation
- `withRetry()` - Retry implementation

**Utility Functions (Orange):**
- Helper functions used by multiple other functions
- Parameter processing functions
- Data transformation functions
- Debug and formatting functions

**External Dependencies (Purple):**
- Functions imported from other files
- Third-party library functions
- Node.js built-in functions

## Maintenance Schedule

**After each feature addition:** Update if new functions are added
**After refactoring:** Update if function relationships change
**Monthly:** Review and verify accuracy against codebase
**Before releases:** Ensure call graph is current and accurate