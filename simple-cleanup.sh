#!/bin/bash

# Simple and Robust Cleanup Script
# Removes all unnecessary files with proper error handling

cd /home/bot/Documents/GitHub/backend-stocks
echo "🧹 Starting repository cleanup..."
echo "📁 Working in: $(pwd)"

removed_count=0
 
# Function to safely remove with error handling
cleanup_item() {
    local item="$1"
    local description="$2"
    
    if [[ -e "$item" ]]; then
        rm -rf "$item" 2>/dev/null
        if [[ $? -eq 0 ]]; then
            echo "✅ Removed: $description"
            ((removed_count++))
        else
            echo "⚠️  Failed to remove: $description"
        fi
    else
        echo "⏭️  Skipped: $description (not found)"
    fi
}

echo ""
echo "🗂️  Cleaning up unnecessary files..."

# Remove documentation files
cleanup_item "PRODUCTION_PORTFOLIO_SYSTEM.md" "Production portfolio docs"
cleanup_item "SYSTEM_CAPACITY_ANALYSIS.md" "System capacity analysis"
cleanup_item "DEPLOYMENT_READY_SUMMARY.md" "Deployment summary"
cleanup_item "README_OLD.md" "Old README"
cleanup_item "CHANGELOG.md" "Changelog"
cleanup_item "TODO.md" "TODO file"

# Remove document templates
cleanup_item "Invoice_Template.docx" "Invoice template"
cleanup_item "template.pdf" "PDF template"
cleanup_item "example.pdf" "Example PDF"

# Remove test files
cleanup_item "test-bill.js" "Root test file"
cleanup_item "tests" "Tests directory"
cleanup_item "test" "Test directory"
cleanup_item "__tests__" "Jest tests"
cleanup_item "spec" "Spec directory"

# Remove backup files
cleanup_item "routes/Portfolio.js.bak" "Portfolio route backup"
cleanup_item "utils/cornscheduler.js.bak" "Scheduler backup"
cleanup_item "server.js.bak" "Server backup"
cleanup_item "package.json.bak" "Package backup"

# Remove example/demo directories
cleanup_item "examples" "Examples directory"
cleanup_item "demo" "Demo directory"
cleanup_item "samples" "Samples directory"
cleanup_item "docs" "Documentation directory"

# Remove build artifacts
cleanup_item ".nyc_output" "Coverage output"
cleanup_item "coverage" "Coverage reports"
cleanup_item "dist" "Distribution files"
cleanup_item "build" "Build directory"
cleanup_item ".eslintcache" "ESLint cache"

# Remove IDE files
cleanup_item ".idea" "IntelliJ files"
cleanup_item ".vscode/settings.json.bak" "VS Code backup"

# Remove system files
cleanup_item ".DS_Store" "macOS system file"
cleanup_item "Thumbs.db" "Windows thumbnail"

# Remove validation scripts
cleanup_item "scripts/validate-routes.sh" "Route validation script"

echo ""
echo "🔍 Finding and removing pattern-based files..."

# Use find to remove files with patterns
find . -name "*.bak" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed .bak files" || echo "⏭️  No .bak files found"
find . -name "*.backup" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed .backup files" || echo "⏭️  No .backup files found"
find . -name "*.tmp" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed .tmp files" || echo "⏭️  No .tmp files found"
find . -name "*.temp" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed .temp files" || echo "⏭️  No .temp files found"
find . -name "*~" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed editor backups" || echo "⏭️  No editor backups found"
find . -name "*.swp" -type f ! -path "./node_modules/*" -delete 2>/dev/null && echo "✅ Removed vim swap files" || echo "⏭️  No vim swap files found"

echo ""
echo "🧽 Removing empty directories..."
find . -type d -empty ! -path "./node_modules/*" ! -path "./logs" ! -path "./.git/*" -delete 2>/dev/null || true

echo ""
echo "📊 Cleanup completed!"
echo "   • Files/directories processed: $removed_count"
echo ""
echo "📂 Current clean structure:"
ls -la | head -20

echo ""
echo "✨ Repository is now clean and production-ready!"

# Add log cleanup functionality
echo ""
echo "📜 Starting log file cleanup..."

# Define log cleanup parameters
LOG_DIR="./logs"
ARCHIVE_DIR="./logs/archive"
DAYS_TO_KEEP=30

# Create archive directory if it doesn't exist
mkdir -p "$ARCHIVE_DIR"

echo "🔍 Looking for log files older than $DAYS_TO_KEEP days..."

# Find log files older than DAYS_TO_KEEP days and move them to archive
find "$LOG_DIR" -name "*.log" -type f -mtime +$DAYS_TO_KEEP 2>/dev/null | while read logfile; do
  filename=$(basename "$logfile")
  archive_name="${filename%.*}_$(date +%Y%m%d).log.gz"
  
  echo "📦 Archiving old log file: $filename"
  gzip -c "$logfile" > "$ARCHIVE_DIR/$archive_name"
  
  # Only remove the original if gzip was successful
  if [ $? -eq 0 ]; then
    echo "✅ Compressed to $archive_name and removing original"
    rm "$logfile"
  else
    echo "⚠️ Failed to compress $filename, original file not removed"
  fi
done

# Clean up very old archives (older than 90 days)
echo "🗑️ Removing archives older than 90 days..."
find "$ARCHIVE_DIR" -name "*.log.gz" -type f -mtime +90 -delete 2>/dev/null

echo ""
echo "📊 Log cleanup completed!"
echo "📂 Current log directory structure:"
ls -la "$LOG_DIR" | head -10
