# Figma Icon Management Plugin

A comprehensive Figma plugin that streamlines icon management by automatically discovering, centralizing, and consolidating all icons within a Figma file. This tool helps designers review, flag inconsistencies, and maintain icon system hygiene.

## 🎯 Features

### Automated Icon Discovery
- **Smart Detection**: Automatically scans your entire Figma file to locate all icon components
- **Keyword Recognition**: Identifies icons based on naming patterns and common icon keywords
- **Size-Based Detection**: Recognizes icons through dimensional analysis (square, small format)
- **Vector Analysis**: Detects icon-like vector structures and simple geometric elements

### Inconsistency Detection
- **Size Standardization**: Flags icons with non-standard dimensions
- **Naming Conventions**: Identifies inconsistent naming patterns
- **Duplicate Detection**: Finds potential duplicate icons across your file
- **Aspect Ratio Checks**: Highlights non-square icons that may need attention

### Centralized Review Interface
- **Clean Dashboard**: Modern, Apple-inspired UI following design system principles
- **Progress Tracking**: Real-time scanning progress with visual feedback
- **Statistics Overview**: Quick metrics on total icons and issues found
- **Organized Results**: Clear presentation of all discovered icons and their properties

### Review Page Creation
- **Automated Layout**: Creates a dedicated review page with all discovered icons
- **Visual Organization**: Icons displayed in a clean grid with detailed information
- **Issue Highlighting**: Clear visual indicators for icons with potential problems
- **Metadata Display**: Shows dimensions, location, and inconsistency details

## 🚀 Getting Started

### Installation
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to compile TypeScript
4. Load the plugin in Figma via Plugins → Development → Import plugin from manifest

### Usage

1. **Launch the Plugin**: Open the Icon Management plugin in any Figma file
2. **Start Scanning**: Click "Start Icon Scan" to analyze your entire document
3. **Review Results**: Once scanning completes, review the discovered icons and flagged issues
4. **Create Review Page**: Generate a centralized page with all icons for team review
5. **Take Action**: Use the insights to consolidate, rename, or standardize your icons

## 🎨 Design Philosophy

This plugin follows Apple's Human Interface Guidelines and design principles:

- **Clarity**: Clean, uncluttered interface with clear visual hierarchy
- **Consistency**: Uniform spacing, typography, and interaction patterns
- **Feedback**: Immediate visual responses to user actions
- **Accessibility**: High contrast colors and readable typography
- **Efficiency**: Streamlined workflows that minimize friction

## 🔧 Technical Details

### Icon Detection Algorithm
The plugin uses a multi-layered approach to identify icons:

1. **Name-based detection** using common icon keywords
2. **Dimensional analysis** for typical icon proportions
3. **Structural analysis** of vector content and complexity
4. **Context evaluation** within frames and component sets

### Inconsistency Analysis
The system evaluates icons across multiple dimensions:

- **Size consistency** relative to the most common dimensions
- **Naming convention** adherence to standard patterns
- **Duplicate identification** through pattern matching
- **Structural integrity** for proper icon characteristics

### Performance Optimization
- **Progressive scanning** with real-time progress updates
- **Efficient traversal** of document structure
- **Memory-conscious** processing of large icon sets
- **Responsive UI** that remains interactive during processing

## 🛠 Development

### Build Commands
```bash
npm run build        # Compile TypeScript
npm run watch        # Watch mode for development
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues automatically
```

### Project Structure
```
├── code.ts          # Main plugin logic
├── ui.html          # User interface
├── manifest.json    # Plugin configuration
├── tsconfig.json    # TypeScript configuration
└── package.json     # Dependencies and scripts
```

## 📊 Use Cases

### Design System Management
- Audit existing icon libraries for consistency
- Identify gaps and redundancies in icon coverage
- Ensure proper naming and organization standards

### Team Handoffs
- Document all icons with source and usage information
- Create visual inventories for new team members
- Maintain metadata for licensing and attribution

### Quality Assurance
- Catch inconsistencies before production
- Standardize icon dimensions and properties
- Eliminate duplicate or similar icons

### Documentation
- Generate comprehensive icon libraries
- Export organized inventories for documentation
- Create reference materials for design guidelines

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues, feature requests, or pull requests to help improve this plugin.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

This plugin addresses key pain points identified by the Figma design community and incorporates feedback from designers and design system managers worldwide.

Below are the steps to get your plugin running. You can also find instructions at:

  https://www.figma.com/plugin-docs/plugin-quickstart-guide/

This plugin template uses Typescript and NPM, two standard tools in creating JavaScript applications.

First, download Node.js which comes with NPM. This will allow you to install TypeScript and other
libraries. You can find the download link here:

  https://nodejs.org/en/download/

Next, install TypeScript using the command:

  npm install -g typescript

Finally, in the directory of your plugin, get the latest type definitions for the plugin API by running:

  npm install --save-dev @figma/plugin-typings

If you are familiar with JavaScript, TypeScript will look very familiar. In fact, valid JavaScript code
is already valid Typescript code.

TypeScript adds type annotations to variables. This allows code editors such as Visual Studio Code
to provide information about the Figma API while you are writing code, as well as help catch bugs
you previously didn't notice.

For more information, visit https://www.typescriptlang.org/

Using TypeScript requires a compiler to convert TypeScript (code.ts) into JavaScript (code.js)
for the browser to run.

We recommend writing TypeScript code using Visual Studio code:

1. Download Visual Studio Code if you haven't already: https://code.visualstudio.com/.
2. Open this directory in Visual Studio Code.
3. Compile TypeScript to JavaScript: Run the "Terminal > Run Build Task..." menu item,
    then select "npm: watch". You will have to do this again every time
    you reopen Visual Studio Code.

That's it! Visual Studio Code will regenerate the JavaScript file every time you save.
