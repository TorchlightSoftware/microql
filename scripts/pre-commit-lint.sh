#!/bin/bash

# Run the linter
echo "🔍 Running linter..."
npm run lint:fix

# Check if any files were modified by the linter
if ! git diff --quiet; then
    echo ""
    echo "⚠️  The linter modified some files:"
    git diff --name-only | sed 's/^/   - /'
    echo ""
    
    # Get list of modified files that were originally staged
    MODIFIED_STAGED_FILES=""
    for file in $(git diff --name-only); do
        if git diff --cached --name-only | grep -q "^$file$"; then
            MODIFIED_STAGED_FILES="$MODIFIED_STAGED_FILES $file"
        fi
    done
    
    if [ -n "$MODIFIED_STAGED_FILES" ]; then
        echo "🔧 Re-staging files that were modified by the linter:"
        for file in $MODIFIED_STAGED_FILES; do
            echo "   - $file"
            git add "$file"
        done
        echo ""
        echo "✅ Linter changes have been staged and will be included in the commit."
    else
        echo "ℹ️  The linter only modified unstaged files. Proceeding with commit."
    fi
else
    echo "✅ No changes needed by linter."
fi

# Exit successfully to allow commit to proceed
exit 0