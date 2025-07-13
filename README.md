# Icon Management - Figma Plugin

*A design systems approach to icon organisation and consistency*

## 🧠 The Design Challenge

As design systems mature and teams scale, icon management becomes increasingly complex. Through years of working with enterprise design systems, I've observed recurring challenges that significantly impact design velocity and consistency:

### The Problem Space
- **Icon proliferation**: Teams create duplicate icons across pages, leading to inconsistency
- **Discovery friction**: Designers struggle to find existing icons, resulting in unnecessary recreation
- **Maintenance overhead**: Without proper organisation, icon libraries become unwieldy
- **Consistency gaps**: Similar icons with slight variations create visual discord
- **Process inefficiency**: Manual icon audits are time-consuming and error-prone

### The Hypothesis
*If we can provide intelligent icon detection and automated organisation tools, designers will maintain more consistent icon libraries whilst reducing the cognitive load of icon management.*

### The Design Approach
This plugin addresses the icon management challenge through three core principles:

1. **Intelligent Detection**: AI-powered scanning that understands design patterns and icon characteristics
2. **Automated Organisation**: Bulk operations that reduce manual effort whilst maintaining design intent
3. **Contextual Insights**: Clear visibility into icon usage, inconsistencies, and opportunities for consolidation

The solution prioritises designer workflow efficiency whilst ensuring design system integrity.

---

## ✨ Features

### 🔍 Intelligent Icon Detection
- **Pattern-based recognition** across your entire Figma file
- Detects **components**, **component sets**, **instances**, and **unresolved icons**
- **Archive page filtering** - automatically excludes archived content
- **Performance optimised** for large files (up to 50 pages)

### 📊 Icon Organisation & Analysis
- **Master component tracking** with instance counts
- **Component set support** with variant detection
- **Inconsistency analysis** to identify duplicates or problematic icons
- **Source identification** for library icons (Lucide, Heroicons, etc.)

### 🔧 Bulk Operations
- **Auto-create components** from unresolved icons
- **Batch export** to organised ZIP files with metadata
- **Icon replacement** with intelligent matching
- **Context menus** for quick actions (right-click functionality)

### 🎨 Enhanced UX
- **Lazy loading** for optimal performance
- **White background detection** with automatic grey backgrounds
- **Rounded dimensions** display (removes decimals)
- **Grid and list views** for icon browsing
- **Search and filtering** capabilities

### 📤 Export System
- **ZIP file exports** with organised folder structure
- **Summary reports** with project details and branding
- **SVG format** with proper naming conventions
- **Metadata preservation** including source page information

## 🚀 Installation

### Method 1: Install from Figma Community (Recommended)
1. Open Figma
2. Go to **Plugins** → **Browse all plugins**
3. Search for "Icon Management"
4. Click **Install**

### Method 2: Install via URL
1. Copy the plugin URL
2. In Figma, go to **Plugins** → **Development** → **Import plugin via URL**
3. Paste the URL and click **Import**

### Method 3: Manual Installation (Development)
1. Clone this repository:
   ```bash
   git clone https://github.com/saimaniganahalli/IconManagement.git
   ```
2. In Figma, go to **Plugins** → **Development** → **Import plugin from manifest**
3. Select the `manifest.json` file from the cloned directory

## 🎯 Usage

### Getting Started
1. **Open the plugin** in your Figma file
2. **Click "Scan for icons"** to discover all icons
3. **Review the results** in the organised dashboard
4. **Use bulk operations** to clean up and organise your icons

### Key Actions
- **Right-click any icon** for context menu options
- **Click variant tabs** to see component set variations
- **Use the search bar** to find specific icons
- **Switch between Grid/List views** for different layouts
- **Export selected icons** using the export button

### Performance Tips
- The plugin handles **large files efficiently** (up to 50 pages)
- **Archive pages are automatically excluded** from scanning
- **Lazy loading** ensures smooth performance with many icons
- **Performance warnings** appear for very large icon sets

## 📝 Technical Implementation

### Built With
- **TypeScript** for type safety and better development experience
- **Modern ES6+** features for optimal performance
- **Figma Plugin API** for seamless integration
- **JSZip** for export functionality

### Performance Optimisations
- **Lazy loading** for variant previews
- **Pagination limits** to prevent memory issues
- **Debounced operations** for smooth user experience
- **Optimised scanning** with intelligent filtering

### Supported Icon Types
- ✅ **Components** (master icons)
- ✅ **Component Sets** (icon families with variants)
- ✅ **Instances** (icon usage throughout the file)
- ✅ **Frames** (icon containers)
- ✅ **Vectors** (standalone icon graphics)
- ✅ **Groups** (grouped icon elements)

## 🔧 Configuration

### Archive Page Filtering
The plugin automatically excludes pages containing:
- `archive` or `archived`
- `🗄️` emoji
- `old` or `backup`
- Custom patterns (configurable)

### Performance Limits
- **Maximum pages**: 50 (for performance)
- **Maximum icons per scan**: 1000
- **Maximum unresolved icons per page**: 50

## 📊 Export Features

### ZIP Export Structure
```
icons-export.zip
├── summary.md                    # Project summary and metadata
├── ComponentSet1/               # Component sets in folders
│   ├── variant1.svg
│   ├── variant2.svg
│   └── variant3.svg
├── icon1.svg                    # Individual icons
├── icon2.svg
└── icon3.svg
```

### Summary Report Includes
- Project name and export date
- Total icon count by type
- Source page information
- Artificial Lack of Intelligence © 2025 branding

## 🐛 Troubleshooting

### Icons Not Being Detected?
1. **Check the console** for detailed debugging information
2. **Verify icon sizes** meet detection criteria (8px - 500px)
3. **Ensure proper naming** for better detection
4. **Check if icons are in archive pages** (automatically excluded)

### Performance Issues?
1. **Large files** are automatically limited to 50 pages
2. **Too many icons** trigger performance warnings
3. **Use filtering** to focus on specific icon types
4. **Clear browser cache** if experiencing slowdowns

### Export Problems?
1. **Check browser permissions** for file downloads
2. **Ensure icons are selected** before exporting
3. **Verify file format support** (SVG only)
4. **Try smaller batches** for very large exports

## 📈 Development

### Running Locally
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
4. Import the `manifest.json` in Figma

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 Licence

This project is licensed under the MIT Licence - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- Built with the [Figma Plugin API](https://www.figma.com/plugin-docs/)
- Icons from [Lucide](https://lucide.dev/) for UI elements
- [JSZip](https://stuk.github.io/jszip/) for export functionality
- [Poppins](https://fonts.google.com/specimen/Poppins) font for typography

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/saimaniganahalli/IconManagement/issues)
- **Discussions**: [GitHub Discussions](https://github.com/saimaniganahalli/IconManagement/discussions)
- **Email**: [Create an issue](https://github.com/saimaniganahalli/IconManagement/issues/new) for support

---

**Artificial Lack of Intelligence © 2025** - Enhancing design workflows with intelligent automation. 