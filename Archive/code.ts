// Figma Icon Management Plugin
// Discovers, analyzes, and consolidates icons across a Figma file

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 600, height: 650 });

// Types for icon data
interface IconInfo {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  page: string;
  frame?: string;
  frameContext?: string; // What kind of frame it's inside (Button, Card, etc.)
  source: string;
  preview?: string; // Base64 encoded image data
  status: 'unresolved' | 'instance' | 'master';
  masterComponentId?: string; // If this is an instance, references the master
  instanceCount?: number; // If this is a master, how many instances
  hasInconsistency: boolean;
  inconsistencyReasons: string[];
  componentSet?: string;
  variants?: number;
  fills?: readonly Paint[];
  strokes?: readonly Paint[];
  isNew?: boolean; // Newly created or detached icon
  isDuplicate?: boolean; // Has duplicates on the same page
}

interface ScanResult {
  totalIcons: number;
  inconsistencies: number;
  discoveredIcons: IconInfo[];
  currentPageName?: string;
}

// AI-powered icon detection with comprehensive scoring system
type IconNode = ComponentNode | ComponentSetNode | FrameNode | InstanceNode | GroupNode | VectorNode | BooleanOperationNode;

function parseIconSource(iconName: string): string {
  // Check for library patterns like "lucide/home", "heroicons/arrow-right"
  const libraryPattern = /^([a-zA-Z0-9-_]+)\/(.+)$/;
  const match = iconName.match(libraryPattern);
  
  if (match) {
    const libraryName = match[1].toLowerCase();
    
    // Map common library names to proper display names
    const libraryMap: Record<string, string> = {
      'lucide': 'Lucide Library',
      'heroicons': 'Heroicons Library', 
      'feather': 'Feather Icons',
      'material': 'Material Icons',
      'fontawesome': 'Font Awesome',
      'bootstrap': 'Bootstrap Icons',
      'tabler': 'Tabler Icons',
      'phosphor': 'Phosphor Icons',
      'remix': 'Remix Icon',
      'ant': 'Ant Design Icons',
      'carbon': 'Carbon Design System',
      'fluent': 'Fluent UI Icons'
    };
    
    return libraryMap[libraryName] || `${libraryName.charAt(0).toUpperCase() + libraryName.slice(1)} Library`;
  }
  
  // Check for other patterns
  if (iconName.toLowerCase().includes('icon')) {
    return 'Icon Library';
  }
  
  // Use Figma file name instead of "Unknown"
  return figma.root.name || 'Unknown';
}

function determineFrameContext(node: IconNode): string | undefined {
  if (!node.parent || node.parent.type !== 'FRAME') {
    return undefined;
  }
  
  const parentName = node.parent.name.toLowerCase();
  
  // Common UI component patterns
  const componentPatterns = [
    { pattern: /button/i, context: 'Button' },
    { pattern: /card/i, context: 'Card' },
    { pattern: /header/i, context: 'Header' },
    { pattern: /nav/i, context: 'Navigation' },
    { pattern: /toolbar/i, context: 'Toolbar' },
    { pattern: /modal/i, context: 'Modal' },
    { pattern: /dialog/i, context: 'Dialog' },
    { pattern: /sidebar/i, context: 'Sidebar' },
    { pattern: /menu/i, context: 'Menu' },
    { pattern: /tab/i, context: 'Tab' },
    { pattern: /badge/i, context: 'Badge' },
    { pattern: /chip/i, context: 'Chip' },
    { pattern: /input/i, context: 'Input' },
    { pattern: /form/i, context: 'Form' },
    { pattern: /dropdown/i, context: 'Dropdown' },
    { pattern: /accordion/i, context: 'Accordion' }
  ];
  
  for (const { pattern, context } of componentPatterns) {
    if (pattern.test(parentName)) {
      return context;
    }
  }
  
  // If no specific pattern, return the frame name
  return node.parent.name;
}

function determineIconStatus(node: IconNode, frameContext?: string): 'unresolved' | 'instance' | 'master' {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return 'master';
  }
  
  if (node.type === 'INSTANCE') {
    return 'instance';
  }
  
  // All other icons are considered "unresolved" (whether they have a specific frame context or not)
  return 'unresolved';
}

async function generateIconPreview(node: IconNode): Promise<string | undefined> {
  try {
    // Export the icon as a small PNG for preview
    const exportSettings: ExportSettings = {
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 } // 2x scale for crisp preview
    };
    
    const imageBytes = await node.exportAsync(exportSettings);
    
    // Convert to base64 for embedding in UI
    const base64 = figma.base64Encode(imageBytes);
    return `data:image/png;base64,${base64}`;
    
  } catch (error) {
    return undefined;
  }
}

function isIconComponent(node: IconNode): boolean {
  const name = node.name.toLowerCase();
  const iconKeywords = [
    // Explicit icon terms
    'icon', 'ico', 'symbol', 'glyph', 'pictogram', 'sign', 'mark', 'badge',
    // UI elements that are typically icons
    'arrow', 'chevron', 'star', 'heart', 'home', 'user', 'menu', 'burger',
    'search', 'close', 'check', 'plus', 'minus', 'edit', 'delete', 'trash',
    'settings', 'info', 'warning', 'error', 'success', 'lock', 'unlock',
    'eye', 'bell', 'mail', 'phone', 'calendar', 'clock', 'location', 'pin',
    // Social and common actions
    'share', 'download', 'upload', 'save', 'print', 'copy', 'paste',
    'undo', 'redo', 'refresh', 'reload', 'sync', 'play', 'pause', 'stop',
    // Navigation and layout
    'back', 'forward', 'next', 'prev', 'up', 'down', 'left', 'right',
    'expand', 'collapse', 'zoom', 'filter', 'sort', 'grid', 'list',
    // File and data
    'file', 'folder', 'document', 'image', 'video', 'audio', 'chart', 'graph'
  ];
  
  return iconKeywords.some(keyword => name.includes(keyword));
}

async function calculateIconScore(node: IconNode): Promise<number> {
  let score = 0;
  
  try {
    // Name-based scoring (most reliable)
    if (isIconComponent(node)) {
      score += 50; // Strong indicator
    }
    
    // Size-based scoring (very reliable for icons)
    const bounds = node.absoluteBoundingBox;
    if (bounds) {
      const { width, height } = bounds;
      const aspectRatio = width / height;
      const size = Math.max(width, height);
      
      // Square or near-square shapes (icons are typically square)
      if (aspectRatio >= 0.8 && aspectRatio <= 1.25) {
        score += 35;
      }
      
      // Perfect square gets extra points
      if (Math.abs(width - height) <= 1) {
        score += 15;
      }
      
      // Common icon sizes (industry standard)
      const commonIconSizes = [12, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 128];
      const exactSizeMatch = commonIconSizes.some(s => Math.abs(width - s) <= 1 && Math.abs(height - s) <= 1);
      const nearSizeMatch = commonIconSizes.some(s => Math.abs(width - s) <= 2 && Math.abs(height - s) <= 2);
      
      if (exactSizeMatch) {
        score += 40; // High score for exact common sizes
      } else if (nearSizeMatch) {
        score += 25; // Good score for near matches
      }
      
      // Icon-typical size range
      if (size >= 8 && size <= 200) {
        score += 15;
      }
      
      // Optimal icon sizes (most common in design systems)
      if ((width === 24 && height === 24) || (width === 32 && height === 32) || (width === 48 && height === 48)) {
        score += 25; // Bonus for most common icon sizes
      }
      
      // Very small icons (typical for UI elements)
      if (size >= 12 && size <= 48) {
        score += 10;
      }
    }
    
    // Structure-based scoring
    if ('children' in node && node.children) {
      const childCount = node.children.length;
      
      // Simple structure typical of icons
      if (childCount <= 15) {
        score += 15;
      }
      
      // Very simple structure
      if (childCount <= 5) {
        score += 10;
      }
    }
    
    // Vector content scoring
    if ('findAll' in node && node.findAll) {
      const vectorNodes = node.findAll((n: any) => 
        n.type === 'VECTOR' || 
        n.type === 'BOOLEAN_OPERATION' ||
        n.type === 'STAR' ||
        n.type === 'POLYGON' ||
        n.type === 'ELLIPSE' ||
        n.type === 'LINE'
      );
      
      if (vectorNodes.length > 0) {
        score += 25;
        
        // High vector density suggests icon
        const nodeChildren = 'children' in node && node.children ? node.children.length : 1;
        if (vectorNodes.length >= nodeChildren * 0.5) {
          score += 15;
        }
      }
    }
    
    // Direct vector/boolean operation scoring
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
      score += 30; // These are likely icon elements
    }
    
    // Node type scoring
    if (node.type === 'COMPONENT_SET') {
      score += 15; // Component sets often contain icons
    } else if (node.type === 'COMPONENT') {
      score += 10; // Components are likely to be icons
    } else if (node.type === 'INSTANCE') {
      score += 8; // Instances might be icon instances
    } else if (node.type === 'FRAME') {
      // Frames need additional validation
      if ('layoutMode' in node && node.layoutMode !== 'NONE') {
        score += 5; // Auto-layout frames could be icons
      } else {
        score += 3; // Regular frames are less likely but possible
      }
    } else if (node.type === 'GROUP') {
      score += 5; // Groups might contain icons
    }
    
    // Parent context scoring
    if (node.parent) {
      const parentName = node.parent.name.toLowerCase();
      if (parentName.includes('icon') || parentName.includes('symbol') || parentName.includes('pictogram')) {
        score += 25;
      }
      
      // Check if parent is an icon-related frame
      if (parentName.includes('toolbar') || parentName.includes('nav') || parentName.includes('button')) {
        score += 10;
      }
    }
    
    // Special handling for instances - check main component
    if (node.type === 'INSTANCE') {
      try {
        const mainComponent = await node.getMainComponentAsync();
        if (mainComponent) {
          const mainComponentName = mainComponent.name.toLowerCase();
          if (isIconComponent(mainComponent as any)) {
            score += 30; // Main component is icon-like
          }
        }
      } catch (mainCompError) {
        // If we can't access main component, continue without extra score
        // Handle main component access issues silently
      }
    }
    
    // Auto-layout bonus for frames (indicates intentional UI component)
    if (node.type === 'FRAME' && 'layoutMode' in node && node.layoutMode !== 'NONE') {
      score += 15; // Auto-layout frames are often purposeful UI elements
      
      // Icon-sized auto-layout gets extra points
      const bounds = node.absoluteBoundingBox;
      if (bounds && bounds.width <= 64 && bounds.height <= 64) {
        score += 10;
      }
    }
    
  } catch (error) {
    // Handle score calculation errors silently
  }
  
  return score;
}

function isLikelyIcon(node: IconNode): boolean {
  try {
    const bounds = node.absoluteBoundingBox;
    if (!bounds) return false;
    
    const aspectRatio = bounds.width / bounds.height;
    const size = Math.max(bounds.width, bounds.height);
    const name = node.name.toLowerCase();
    
    // PRIORITY 1: Component/ComponentSet icons (highest priority)
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      // Must be reasonably square and icon-sized
      if (aspectRatio >= 0.75 && aspectRatio <= 1.33 && size <= 128) {
        return true;
      }
      return false;
    }
    
    // PRIORITY 2: Instance icons
    if (node.type === 'INSTANCE') {
      // Must be reasonably square and icon-sized
      if (aspectRatio >= 0.75 && aspectRatio <= 1.33 && size <= 128) {
        return true;
      }
      return false;
    }
    
    // PRIORITY 3: Strict square frames only (for unresolved icons)
    if (node.type === 'FRAME') {
      // Much stricter requirements for frames
      if (aspectRatio < 0.9 || aspectRatio > 1.1) {
        return false;
      }
      
      // Must be common icon sizes
      const isIconSize = [16, 20, 24, 28, 32, 40, 48, 64].some(s => 
        Math.abs(bounds.width - s) <= 1 && Math.abs(bounds.height - s) <= 1);
      
      if (!isIconSize) {
        return false;
      }
      
      // Must have icon-like naming
      const hasIconName = name.includes('icon') || 
                         name.includes('/') || // Library pattern
                         isIconComponent(node); // Use existing keyword detection
      
      if (!hasIconName) {
        return false;
      }
      
      // Check if frame contains vector/graphics content (actual icon content)
      const hasVectorContent = node.findChild(child => 
        child.type === 'VECTOR' || 
        child.type === 'BOOLEAN_OPERATION' ||
        child.type === 'GROUP'
      );
      
      if (!hasVectorContent) {
        return false;
      }
      
      return true;
    }
    
    // PRIORITY 4: Direct vector/group icons (only if not inside detected frames)
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'GROUP') {
      // Check if this node is inside a frame that could be an icon
      let parent = node.parent;
      while (parent && parent.type !== 'PAGE') {
        if (parent.type === 'FRAME') {
          const parentBounds = parent.absoluteBoundingBox;
          if (parentBounds) {
            const parentAspect = parentBounds.width / parentBounds.height;
            // If parent frame is square-ish and icon-sized, skip this vector
            if (parentAspect >= 0.9 && parentAspect <= 1.1 && 
                Math.max(parentBounds.width, parentBounds.height) <= 64) {
              return false;
            }
          }
        }
        parent = parent.parent;
      }
      
      // Strict requirements for standalone vectors
      if (aspectRatio >= 0.9 && aspectRatio <= 1.1 && 
          size >= 16 && size <= 48 && 
          isIconComponent(node)) {
        return true;
      }
      
      return false;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

function analyzeIconConsistency(icons: IconInfo[]): IconInfo[] {
  const sizeGroups = new Map<string, IconInfo[]>();
  const namePatterns = new Map<string, IconInfo[]>();
  const pageGroups = new Map<string, IconInfo[]>();
  
  // Group icons by size
  icons.forEach(icon => {
    const sizeKey = `${icon.width}x${icon.height}`;
    if (!sizeGroups.has(sizeKey)) {
      sizeGroups.set(sizeKey, []);
    }
    sizeGroups.get(sizeKey)!.push(icon);
  });
  
  // Group icons by name pattern
  icons.forEach(icon => {
    const basePattern = icon.name.toLowerCase()
      .replace(/[-_]/g, ' ')
      .replace(/\d+/g, '')
      .trim();
    
    if (!namePatterns.has(basePattern)) {
      namePatterns.set(basePattern, []);
    }
    namePatterns.get(basePattern)!.push(icon);
  });

  // Group icons by page to detect duplicates
  icons.forEach(icon => {
    if (!pageGroups.has(icon.page)) {
      pageGroups.set(icon.page, []);
    }
    pageGroups.get(icon.page)!.push(icon);
  });
  
  // Analyze inconsistencies
  return icons.map(icon => {
    const inconsistencies: string[] = [];
    let isNew = false;
    let isDuplicate = false;
    
    // Check if this is a newly detached icon (frame type that looks like it should be a component)
    if (icon.status === 'unresolved' && icon.type === 'FRAME') {
      // Look for similar named components to see if this was recently detached
      const potentialOriginal = icons.find(other => 
        other.status === 'master' && 
        other.name.toLowerCase().includes(icon.name.toLowerCase().replace(/\s*copy\s*\d*/i, ''))
      );
      
      if (potentialOriginal || icon.name.toLowerCase().includes('copy')) {
        isNew = true;
        inconsistencies.push('Appears to be detached from component');
      }
    }
    
    // Check for duplicates within the same page
    const pageIcons = pageGroups.get(icon.page) || [];
    const basePattern = icon.name.toLowerCase()
      .replace(/[-_]/g, ' ')
      .replace(/\d+/g, '')
      .replace(/\s*copy\s*\d*/i, '')
      .trim();
    
    const duplicatesOnPage = pageIcons.filter(other => {
      if (other.id === icon.id) return false;
      const otherPattern = other.name.toLowerCase()
        .replace(/[-_]/g, ' ')
        .replace(/\d+/g, '')
        .replace(/\s*copy\s*\d*/i, '')
        .trim();
      return otherPattern === basePattern;
    });
    
    if (duplicatesOnPage.length > 0) {
      isDuplicate = true;
      inconsistencies.push(`Duplicate on page (${duplicatesOnPage.length + 1} total)`);
    }
    
    // Size inconsistency check
    const mostCommonSize = Array.from(sizeGroups.entries())
      .sort(([,a], [,b]) => b.length - a.length)[0];
    
    if (mostCommonSize && mostCommonSize[1].length > 1) {
      const iconSizeKey = `${icon.width}x${icon.height}`;
      if (iconSizeKey !== mostCommonSize[0] && sizeGroups.get(iconSizeKey)!.length < mostCommonSize[1].length / 2) {
        inconsistencies.push(`Non-standard size (${iconSizeKey}, most common: ${mostCommonSize[0]})`);
      }
    }
    
    // Naming convention check
    const hasInconsistentNaming = !icon.name.match(/^[a-zA-Z][a-zA-Z0-9]*([_-][a-zA-Z0-9]+)*$/);
    if (hasInconsistentNaming) {
      inconsistencies.push('Inconsistent naming convention');
    }
    
    // Check for potential duplicates across pages
    const similarIcons = namePatterns.get(basePattern) || [];
    if (similarIcons.length > 1 && !isDuplicate) {
      inconsistencies.push(`Potential duplicate across pages (${similarIcons.length} similar icons found)`);
    }
    
    // Square aspect ratio check
    if (Math.abs(icon.width - icon.height) > 2) {
      inconsistencies.push('Non-square aspect ratio');
    }
    
    return {
      ...icon,
      hasInconsistency: inconsistencies.length > 0,
      inconsistencyReasons: inconsistencies,
      isNew,
      isDuplicate
    };
  });
}

function calculateInstanceCounts(icons: IconInfo[]): IconInfo[] {
  // Count instances for each master component
  const masterComponentCounts = new Map<string, number>();
  
  icons.forEach(icon => {
    if (icon.masterComponentId) {
      const currentCount = masterComponentCounts.get(icon.masterComponentId) || 0;
      masterComponentCounts.set(icon.masterComponentId, currentCount + 1);
    }
  });
  
  // Update master components with their instance counts
  return icons.map(icon => {
    if (icon.status === 'master') {
      return {
        ...icon,
        instanceCount: masterComponentCounts.get(icon.id) || 0
      };
    }
    return icon;
  });
}

async function consolidateSimilarIcons(icons: IconInfo[], scope: string = 'all-pages', currentPageName?: string): Promise<void> {
  try {
    // Filter icons by scope - ONLY process unresolved icons to avoid creating duplicate instances
    let iconsToProcess: IconInfo[];
    if (scope === 'current-page' && currentPageName) {
      iconsToProcess = icons.filter(icon => 
        icon.page === currentPageName && 
        icon.status === 'unresolved'
      );
    } else {
      iconsToProcess = icons.filter(icon => 
        icon.status === 'unresolved'
      );
    }
    
    // First pass: Find exact duplicates and group aggressively
    const duplicateGroups = new Map<string, IconInfo[]>();
    const uniqueIcons = new Map<string, IconInfo>();
    const processedNodes = new Set<string>();
    
    iconsToProcess.forEach(icon => {
      // Create aggressive duplicate detection key (all icons are already unresolved)
      const normalizedName = icon.name.toLowerCase()
        .replace(/[-_\s\.]/g, '') // Remove all separators
        .replace(/\d+/g, '') // Remove all numbers
        .replace(/(icon|svg|vector|graphic|outline|filled|solid)/g, '') // Remove common suffixes
        .replace(/[^a-z]/g, ''); // Keep only letters
      
      // Group by normalized name + approximate size (8px tolerance) + source
      const sizeGroup = `${Math.round(icon.width/8)*8}x${Math.round(icon.height/8)*8}`;
      const duplicateKey = `${normalizedName}_${sizeGroup}_${icon.source}`;
      
      if (!duplicateGroups.has(duplicateKey)) {
        duplicateGroups.set(duplicateKey, []);
      }
      duplicateGroups.get(duplicateKey)!.push(icon);
    });
    
    let componentsCreated = 0;
    const masterComponents: ComponentNode[] = [];
    
    // Find or create the master Icon Library page (single source of truth)
    let masterPage = figma.root.children.find(page => page.name === '🎯 Icon Library');
    
    if (!masterPage) {
      // Create the library page if it doesn't exist
      masterPage = figma.createPage();
      masterPage.name = '🎯 Icon Library';
    } else {
      // Use existing library page - don't create date-versioned copies
  
    }
    
    // Calculate starting position based on existing components in the library
    let currentX = 0;
    let currentY = 0;
    const iconSpacing = 120;
    const rowLimit = 8;
    
    // If library page already has components, position new ones below them
    if (masterPage.children.length > 0) {
      const existingNodes = masterPage.children.filter(child => 
        child.type === 'COMPONENT' || child.type === 'COMPONENT_SET'
      );
      
      if (existingNodes.length > 0) {
        // Find the lowest Y position and start below it
        const maxY = Math.max(...existingNodes.map(node => 
          'absoluteBoundingBox' in node && node.absoluteBoundingBox 
            ? node.absoluteBoundingBox.y + node.absoluteBoundingBox.height 
            : 0
        ));
        currentY = maxY + iconSpacing;
      }
    }
    
    // Second pass: Create unique components and remove duplicates
    for (const [duplicateKey, group] of duplicateGroups) {
      // Only keep the first icon from each duplicate group, remove the rest
      const masterIcon = group[0];
      const duplicatesToRemove = group.slice(1);
      
      // Add master to unique icons if not already processed
      if (!processedNodes.has(masterIcon.id)) {
        uniqueIcons.set(duplicateKey, masterIcon);
        processedNodes.add(masterIcon.id);
      }
      
      // Mark duplicates for removal
      duplicatesToRemove.forEach(duplicate => {
        processedNodes.add(duplicate.id);
      });
    }
    
        // Process unique icons only (no duplicates)
    for (const [key, icon] of uniqueIcons) {
      const originalNode = await figma.getNodeByIdAsync(icon.id);
      
      if (originalNode && 'clone' in originalNode) {
        try {
          const component = figma.createComponent();
          component.name = `${icon.source}/${icon.name.replace(/[^a-zA-Z0-9-_\s]/g, '')}`;
          
          const clone = (originalNode as SceneNode).clone();
          if ('x' in clone && 'y' in clone) {
            clone.x = 0;
            clone.y = 0;
          }
          
          component.appendChild(clone);
          component.resize(icon.width, icon.height);
          component.x = currentX;
          component.y = currentY;
          
          masterPage.appendChild(component);
          masterComponents.push(component);
          
          componentsCreated++;
          
          // Now replace ALL instances of this icon (original + duplicates) with instances
          const allMatches = duplicateGroups.get(key) || [icon];
          for (const matchingIcon of allMatches) {
            await replaceWithInstance(matchingIcon, component);
          }
          
          // Update grid position
          currentX += iconSpacing;
          if (masterComponents.length % rowLimit === 0) {
            currentX = 0;
            currentY += iconSpacing;
          }
        } catch (error) {
          // Handle component creation errors silently
        }
      }
    }
    
    // No need to create consolidation review pages - keep it simple
    
    // Calculate additional statistics for better toast messages
    const totalIconsReplaced = iconsToProcess.length;
    const consolidationAffectedPages = new Set<string>();
    
    // Count pages affected by looking at the original icons
    iconsToProcess.forEach((icon: IconInfo) => {
      if (icon.page) {
        consolidationAffectedPages.add(icon.page);
      }
    });
    
    const scopeText = scope === 'current-page' ? `on page "${currentPageName}"` : 'across all pages';
    figma.ui.postMessage({
      type: 'consolidation-complete',
      data: { 
        componentsCreated,
        iconsReplaced: totalIconsReplaced,
        pagesAffected: consolidationAffectedPages.size,
        message: `Created ${componentsCreated} master components in the Icon Library ${scopeText}. Unresolved icons replaced with instances (positions preserved).`,
        newMasterComponents: masterComponents.map(comp => comp.id)
      }
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'consolidation-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
}

// Helper function to replace original icon with instance
async function replaceWithInstance(icon: IconInfo, component: ComponentNode): Promise<void> {
  try {
    const nodeToReplace = await figma.getNodeByIdAsync(icon.id) as SceneNode;
    
    if (nodeToReplace && nodeToReplace.parent && 'x' in nodeToReplace && 'y' in nodeToReplace) {
      const instance = component.createInstance();
      
      // Preserve exact position
      instance.x = nodeToReplace.x;
      instance.y = nodeToReplace.y;
      
      // Preserve all visual transformations
      if ('rotation' in nodeToReplace && 'rotation' in instance) {
        instance.rotation = nodeToReplace.rotation;
      }
      
      // Preserve opacity
      if ('opacity' in nodeToReplace && 'opacity' in instance) {
        instance.opacity = nodeToReplace.opacity;
      }
      
      // Preserve visibility
      if ('visible' in nodeToReplace && 'visible' in instance) {
        instance.visible = nodeToReplace.visible;
      }
      
      // Preserve blend mode
      if ('blendMode' in nodeToReplace && 'blendMode' in instance) {
        instance.blendMode = nodeToReplace.blendMode;
      }
      
      // Preserve constraints (for responsive behavior)
      if ('constraints' in nodeToReplace && 'constraints' in instance) {
        instance.constraints = { ...nodeToReplace.constraints };
      }
      
      // Preserve locked state
      if ('locked' in nodeToReplace && 'locked' in instance) {
        instance.locked = nodeToReplace.locked;
      }
      
      // Copy any effects (shadows, blurs, etc.)
      if ('effects' in nodeToReplace && 'effects' in instance) {
        try {
          instance.effects = [...nodeToReplace.effects];
        } catch (effectsError) {
          // Handle effects copying errors silently
        }
      }
      
      // Insert instance in the EXACT same position in the hierarchy
      const parent = nodeToReplace.parent;
      if (parent && 'children' in parent) {
        const index = parent.children.indexOf(nodeToReplace);
        if (index >= 0) {
          parent.insertChild(index, instance);
        } else {
          // Fallback: append to parent
          parent.appendChild(instance);
        }
      }
      
      // Remove the original AFTER the replacement is properly positioned
      nodeToReplace.remove();
      
    }
  } catch (error) {
    // Handle replacement errors silently
  }
}

// Removed createConsolidationReviewPage function - no longer needed for simplified workflow

async function consolidateLibraryDuplicates(icons: IconInfo[], currentPageName: string): Promise<void> {
  let errors: string[] = [];
  let duplicatesRemoved = 0;
  
  try {
    if (currentPageName !== '🎯 Icon Library') {
      throw new Error('This function only works on the Icon Library page');
    }
    
    // Get only icons from the Icon Library page
    const libraryIcons = icons.filter(icon => 
      icon.page === currentPageName && 
      (icon.status === 'master' || icon.type === 'COMPONENT' || icon.type === 'COMPONENT_SET')
    );
    
    // Group similar icons to find duplicates
    const duplicateGroups = new Map<string, IconInfo[]>();
    
    libraryIcons.forEach(icon => {
      const basePattern = icon.name.toLowerCase()
        .replace(/[-_\s\.]/g, '')
        .replace(/\d+/g, '')
        .replace(/\s*copy\s*\d*/i, '')
        .replace(/[^a-z]/g, '');
      const sizeKey = `${Math.round(icon.width/4)*4}x${Math.round(icon.height/4)*4}`; // 4px tolerance
      const groupKey = `${basePattern}_${sizeKey}`;
      
      if (!duplicateGroups.has(groupKey)) {
        duplicateGroups.set(groupKey, []);
      }
      duplicateGroups.get(groupKey)!.push(icon);
    });
    
    const componentsToKeep: ComponentNode[] = [];
    
    // Process each group of duplicates
    for (const [groupKey, group] of duplicateGroups) {
      if (group.length <= 1) continue; // No duplicates in this group
      
      try {
        // Sort by creation date or name to pick the "best" one to keep
        group.sort((a, b) => {
          // Prefer icons without "copy" in the name
          const aCopy = a.name.toLowerCase().includes('copy');
          const bCopy = b.name.toLowerCase().includes('copy');
          if (aCopy && !bCopy) return 1;
          if (!aCopy && bCopy) return -1;
          
          // Otherwise, prefer the first one alphabetically
          return a.name.localeCompare(b.name);
        });
        
        const iconToKeep = group[0];
        const iconsToRemove = group.slice(1);
        
        // Get the component node to keep
        const componentToKeep = await figma.getNodeByIdAsync(iconToKeep.id);
        
        if (!componentToKeep) {
          errors.push(`Could not find component to keep: ${iconToKeep.name}`);
          continue;
        }
        
        if (componentToKeep.type !== 'COMPONENT' && componentToKeep.type !== 'COMPONENT_SET') {
          errors.push(`Node is not a component: ${iconToKeep.name} (type: ${componentToKeep.type})`);
          continue;
        }
        
        const keepComponent = componentToKeep as ComponentNode;
        componentsToKeep.push(keepComponent);
        
        // Remove duplicate components and update their instances
        for (const duplicate of iconsToRemove) {
          try {
            const duplicateComponent = await figma.getNodeByIdAsync(duplicate.id);
            
            if (!duplicateComponent) {
              errors.push(`Could not find duplicate component: ${duplicate.name}`);
              continue;
            }
            
            if (duplicateComponent.type !== 'COMPONENT' && duplicateComponent.type !== 'COMPONENT_SET') {
              errors.push(`Duplicate node is not a component: ${duplicate.name} (type: ${duplicateComponent.type})`);
              continue;
            }
            
            const dupComponent = duplicateComponent as ComponentNode;
            
            // Find all instances of the duplicate component across all pages
            const allInstanceNodes = figma.root.findAll(node => node.type === 'INSTANCE') as InstanceNode[];
            const matchingInstances: InstanceNode[] = [];
            
            // Check each instance async to avoid mainComponent access issues
            for (const instance of allInstanceNodes) {
              try {
                const mainComponent = await instance.getMainComponentAsync();
                if (mainComponent && mainComponent.id === dupComponent.id) {
                  matchingInstances.push(instance);
                }
              } catch (mainCompError) {
                // Handle main component access issues silently
              }
            }
            
            // Replace instances with instances of the component we're keeping
            for (const instance of matchingInstances) {
              try {
                const newInstance = keepComponent.createInstance();
                
                // Copy position and properties safely
                if ('x' in instance && 'x' in newInstance) {
                  newInstance.x = instance.x;
                }
                if ('y' in instance && 'y' in newInstance) {
                  newInstance.y = instance.y;
                }
                if ('rotation' in instance && 'rotation' in newInstance) {
                  newInstance.rotation = instance.rotation;
                }
                if ('opacity' in instance && 'opacity' in newInstance) {
                  newInstance.opacity = instance.opacity;
                }
                
                // Insert in same position in hierarchy
                const parent = instance.parent;
                if (parent && 'children' in parent) {
                  const index = parent.children.indexOf(instance);
                  if (index >= 0) {
                    parent.insertChild(index, newInstance);
                  } else {
                    parent.appendChild(newInstance);
                  }
                }
                
                // Remove old instance
                instance.remove();
                
              } catch (instanceError) {
                errors.push(`Error replacing instance of "${duplicate.name}": ${instanceError instanceof Error ? instanceError.message : 'Unknown error'}`);
              }
            }
            
            // Remove the duplicate component (only if no errors with instances)
            try {
              dupComponent.remove();
              duplicatesRemoved++;
            } catch (removeError) {
              errors.push(`Error removing duplicate component "${duplicate.name}": ${removeError instanceof Error ? removeError.message : 'Unknown error'}`);
            }
            
          } catch (error) {
            errors.push(`Error processing duplicate "${duplicate.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      } catch (groupError) {
        errors.push(`Error processing group "${groupKey}": ${groupError instanceof Error ? groupError.message : 'Unknown error'}`);
      }
    }
    

    
    // Send success message with error details if any
    const message = errors.length > 0 
      ? `Removed ${duplicatesRemoved} duplicates with ${errors.length} errors. See details in response.`
      : `Removed ${duplicatesRemoved} duplicate components from Icon Library`;
    
    figma.ui.postMessage({
      type: 'library-consolidation-complete',
      data: { 
        duplicatesRemoved,
        errors: errors.length,
        errorDetails: errors,
        message
      }
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'library-consolidation-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
  }
}

async function scanForIcons(): Promise<ScanResult> {
  const allIcons: IconInfo[] = [];
  const pages = figma.root.children;
  let processedPages = 0;
  
  // Performance limits to prevent memory issues
  const MAX_ICONS = 500; // Prevent memory overflow
  const MAX_PAGES = 50;  // Reasonable scanning limit
  
  // Send initial progress
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 0 }
  });
  
  // Check for excessively large files
  if (pages.length > MAX_PAGES) {
    figma.ui.postMessage({
      type: 'scan-error',
      data: { error: `File too large (${pages.length} pages). Plugin supports max ${MAX_PAGES} pages for performance.` }
    });
    return { totalIcons: 0, inconsistencies: 0, discoveredIcons: [] };
  }
  
  // Load all pages first (required by Figma API)
  try {
    await figma.loadAllPagesAsync();
  } catch (loadError) {
    figma.ui.postMessage({
      type: 'scan-error',
      data: { error: 'Failed to load pages: ' + (loadError instanceof Error ? loadError.message : 'Unknown error') }
    });
    return { totalIcons: 0, inconsistencies: 0, discoveredIcons: [] };
  }
  
  for (const page of pages) {
    try {
      // Find all potential icon nodes: components, component sets, frames, instances, and groups
      const potentialIcons = page.findAll(node => 
        node.type === 'COMPONENT' || 
        node.type === 'COMPONENT_SET' ||
        node.type === 'FRAME' ||
        node.type === 'INSTANCE' ||
        node.type === 'GROUP' ||
        node.type === 'VECTOR' ||
        node.type === 'BOOLEAN_OPERATION'
      ) as any[];
      
      // First pass: identify component icons and instances to avoid duplicating with their children
      const componentIcons = new Set<string>();
      const componentInstances = new Set<string>();
      
      for (const node of potentialIcons) {
        if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && isLikelyIcon(node)) {
          componentIcons.add(node.id);
        }
        
        // CRITICAL: Identify all component instances to ignore their internal structure
        // (We'll still evaluate the instances themselves as potential icons later)
        if (node.type === 'INSTANCE') {
          componentInstances.add(node.id);
        }
      }
      
      // Second pass: identify frame-level icons to avoid duplicating with their vector children
      const frameIcons = new Set<string>();
      for (const node of potentialIcons) {
        if ((node.type === 'FRAME' || node.type === 'GROUP') && isLikelyIcon(node)) {
          // Check if this frame is inside a component icon or component instance
          let parent = node.parent;
          let isInsideComponent = false;
          
          while (parent && parent.type !== 'PAGE') {
            if (componentIcons.has(parent.id) || componentInstances.has(parent.id)) {
              isInsideComponent = true;
              break;
            }
            parent = parent.parent;
          }
          
          if (!isInsideComponent) {
            frameIcons.add(node.id);
          }
        }
      }
      
      for (const node of potentialIcons) {
        // CRITICAL: Skip ALL nodes that are inside component instances (prevents false positives)
        if (node.parent) {
          let parent = node.parent;
          let isInsideInstance = false;
          
          while (parent && parent.type !== 'PAGE') {
            if (componentInstances.has(parent.id)) {
              isInsideInstance = true;
              break;
            }
            parent = parent.parent;
          }
          
          if (isInsideInstance) {
            continue; // Skip this node entirely as it's inside a component instance
          }
        }
        
        // Skip frames/groups that are children of already-detected component icons or instances
        if ((node.type === 'FRAME' || node.type === 'GROUP') && node.parent) {
          let parent = node.parent;
          let isChildOfComponent = false;
          
          // Walk up the parent chain to check if this frame is inside a detected component icon or instance
          while (parent && parent.type !== 'PAGE') {
            if (componentIcons.has(parent.id) || componentInstances.has(parent.id)) {
              isChildOfComponent = true;
              break;
            }
            parent = parent.parent;
          }
          
          if (isChildOfComponent) {
            continue; // Skip this frame as its parent component/instance is already detected
          }
        }
        
        // Skip vectors/boolean operations that are children of components, instances, or frame icons
        if ((node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') && node.parent) {
          let parent = node.parent;
          let isChildOfContainer = false;
          
          // Walk up the parent chain to check if this vector is inside any detected container
          while (parent && parent.type !== 'PAGE') {
            if (frameIcons.has(parent.id) || componentIcons.has(parent.id) || componentInstances.has(parent.id)) {
              isChildOfContainer = true;
              break;
            }
            parent = parent.parent;
          }
          
          if (isChildOfContainer) {
            continue; // Skip this vector as its parent container is already detected
          }
        }
      // Check icon limit to prevent memory issues
      if (allIcons.length >= MAX_ICONS) {
        figma.ui.postMessage({
          type: 'scan-progress',
          data: { percentage: 100 }
        });
        
        const analyzedIcons = analyzeIconConsistency(allIcons);
        const inconsistencyCount = analyzedIcons.filter(icon => icon.hasInconsistency).length;
        
        figma.ui.postMessage({
          type: 'scan-complete',
          data: {
            totalIcons: analyzedIcons.length,
            inconsistencies: inconsistencyCount,
            discoveredIcons: analyzedIcons,
            warning: `Reached maximum of ${MAX_ICONS} icons. Some icons may not be included.`
          }
        });
        
        return {
          totalIcons: analyzedIcons.length,
          inconsistencies: inconsistencyCount,
          discoveredIcons: analyzedIcons
        };
      }
      
      try {
        if (isLikelyIcon(node)) {
          const bounds = node.absoluteBoundingBox;
          const parentFrame = node.parent?.type === 'FRAME' ? node.parent.name : undefined;
          const frameContext = determineFrameContext(node);
          const status = determineIconStatus(node, frameContext);
          
          // Generate preview image
          const preview = await generateIconPreview(node);
          
          // Get master component ID for instances (using async method)
          let masterComponentId: string | undefined = undefined;
          if (node.type === 'INSTANCE') {
            try {
              const mainComponent = await node.getMainComponentAsync();
              masterComponentId = mainComponent ? mainComponent.id : undefined;
            } catch (mainCompError) {
              // Silently handle main component access issues
            }
          }
          
          const iconInfo: IconInfo = {
            id: node.id,
            name: node.name,
            type: node.type,
            width: bounds?.width || 0,
            height: bounds?.height || 0,
            page: page.name,
            frame: parentFrame,
            frameContext: frameContext,
            source: parseIconSource(node.name),
            preview: preview,
            status: status,
            masterComponentId: masterComponentId,
            instanceCount: node.type === 'COMPONENT' ? 0 : undefined, // Will be calculated later
            hasInconsistency: false,
            inconsistencyReasons: [],
            componentSet: node.type === 'COMPONENT_SET' ? node.name : undefined,
            variants: node.type === 'COMPONENT_SET' && 'children' in node ? node.children.length : undefined,
            fills: node.type === 'COMPONENT' && 'fills' in node && Array.isArray(node.fills) ? node.fills : undefined,
            strokes: node.type === 'COMPONENT' && 'strokes' in node && Array.isArray(node.strokes) ? node.strokes : undefined
          };
          
          allIcons.push(iconInfo);
        }
      } catch (nodeError) {
        // Continue with next node
      }
    }
    
    } catch (pageError) {
      // Continue with next page
    }
    
    processedPages++;
    const progress = (processedPages / pages.length) * 80; // Reserve 20% for analysis
    figma.ui.postMessage({
      type: 'scan-progress',
      data: { percentage: progress }
    });
  }
  
  // Analyze inconsistencies
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 90 }
  });
  
  const analyzedIcons = analyzeIconConsistency(allIcons);
  const inconsistencyCount = analyzedIcons.filter(icon => icon.hasInconsistency).length;
  
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 100 }
  });
  
  // Calculate instance counts for master components
  const finalIcons = calculateInstanceCounts(analyzedIcons);
  
  return {
    totalIcons: finalIcons.length,
    inconsistencies: inconsistencyCount,
    discoveredIcons: finalIcons,
    currentPageName: figma.currentPage.name
  };
}

async function createReviewPage(icons: IconInfo[]): Promise<void> {
  try {
    // Limit icons for performance (prevent memory issues)
    const MAX_REVIEW_ICONS = 100;
    const iconsToDisplay = icons.slice(0, MAX_REVIEW_ICONS);
    const wasLimited = icons.length > MAX_REVIEW_ICONS;
    
    // Create new page for review
    const reviewPage = figma.createPage();
    reviewPage.name = `🔍 Icon Review - ${new Date().toLocaleDateString()}${wasLimited ? ' (Limited)' : ''}`;
    
    // Set as current page
    figma.currentPage = reviewPage;
    
         // Create main frame
     const mainFrame = figma.createFrame();
     mainFrame.name = "Icon Management Review";
     mainFrame.resize(1200, Math.max(800, iconsToDisplay.length * 120 + 200));
     mainFrame.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99 } }];
    
         // Add title
     const title = figma.createText();
     try {
       await figma.loadFontAsync({ family: "Inter", style: "Bold" });
       title.fontName = { family: "Inter", style: "Bold" };
     } catch {
       // Fallback to system font
       await figma.loadFontAsync({ family: "Roboto", style: "Bold" });
       title.fontName = { family: "Roboto", style: "Bold" };
     }
    title.fontSize = 32;
    title.characters = "Icon Management Review";
    title.fills = [{ type: 'SOLID', color: { r: 0.11, g: 0.11, b: 0.12 } }];
    title.x = 40;
    title.y = 40;
    mainFrame.appendChild(title);
    
         // Add summary
     const summary = figma.createText();
     try {
       await figma.loadFontAsync({ family: "Inter", style: "Regular" });
       summary.fontName = { family: "Inter", style: "Regular" };
     } catch {
       // Fallback to system font
       await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
       summary.fontName = { family: "Roboto", style: "Regular" };
     }
    summary.fontSize = 16;
         summary.characters = `Found ${icons.length} icons • ${icons.filter(i => i.hasInconsistency).length} with potential issues${wasLimited ? ` (Showing first ${MAX_REVIEW_ICONS})` : ''}`;
    summary.fills = [{ type: 'SOLID', color: { r: 0.53, g: 0.53, b: 0.55 } }];
    summary.x = 40;
    summary.y = 85;
    mainFrame.appendChild(summary);
    
         // Create icon grid
     let currentY = 150;
     const itemHeight = 100;
     const padding = 20;
     
     for (let i = 0; i < iconsToDisplay.length; i++) {
       const icon = iconsToDisplay[i];
      
      // Create item container
      const itemFrame = figma.createFrame();
      itemFrame.name = `Icon Item ${i + 1}`;
      itemFrame.resize(1120, itemHeight);
      itemFrame.x = 40;
      itemFrame.y = currentY;
      itemFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      itemFrame.cornerRadius = 12;
      itemFrame.effects = [{
        type: 'DROP_SHADOW',
        color: { r: 0, g: 0, b: 0, a: 0.1 },
        offset: { x: 0, y: 2 },
        radius: 8,
        spread: 0,
        visible: true,
        blendMode: 'NORMAL'
      }];
      
      try {
        // Clone the original icon
        const originalNode = await figma.getNodeByIdAsync(icon.id);
        if (originalNode && (
          originalNode.type === 'COMPONENT' || 
          originalNode.type === 'COMPONENT_SET' || 
          originalNode.type === 'FRAME' || 
          originalNode.type === 'INSTANCE'
        )) {
          const iconClone = originalNode.clone();
          iconClone.x = padding;
          iconClone.y = (itemHeight - icon.height) / 2;
          itemFrame.appendChild(iconClone);
        }
      } catch (error) {
        // If we can't clone the icon, create a placeholder
        const placeholder = figma.createRectangle();
        placeholder.resize(40, 40);
        placeholder.x = padding;
        placeholder.y = (itemHeight - 40) / 2;
        placeholder.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }];
        placeholder.cornerRadius = 8;
        itemFrame.appendChild(placeholder);
      }
      
             // Add icon details
       const nameText = figma.createText();
       try {
         await figma.loadFontAsync({ family: "Inter", style: "Bold" });
         nameText.fontName = { family: "Inter", style: "Bold" };
       } catch {
         await figma.loadFontAsync({ family: "Roboto", style: "Bold" });
         nameText.fontName = { family: "Roboto", style: "Bold" };
       }
      nameText.fontSize = 18;
      nameText.characters = icon.name;
      nameText.fills = [{ type: 'SOLID', color: { r: 0.11, g: 0.11, b: 0.12 } }];
      nameText.x = 100;
      nameText.y = padding;
      itemFrame.appendChild(nameText);
      
             const detailsText = figma.createText();
       try {
         await figma.loadFontAsync({ family: "Inter", style: "Regular" });
         detailsText.fontName = { family: "Inter", style: "Regular" };
       } catch {
         await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
         detailsText.fontName = { family: "Roboto", style: "Regular" };
       }
      detailsText.fontSize = 14;
      detailsText.characters = `${icon.width}×${icon.height} • ${icon.page}${icon.frame ? ` > ${icon.frame}` : ''}`;
      detailsText.fills = [{ type: 'SOLID', color: { r: 0.53, g: 0.53, b: 0.55 } }];
      detailsText.x = 100;
      detailsText.y = 45;
      itemFrame.appendChild(detailsText);
      
      // Add inconsistency badges
      if (icon.hasInconsistency) {
        const issuesBadge = figma.createFrame();
        issuesBadge.resize(80, 24);
        issuesBadge.x = 1000;
        issuesBadge.y = padding;
        issuesBadge.fills = [{ type: 'SOLID', color: { r: 1, g: 0.23, b: 0.19 } }];
        issuesBadge.cornerRadius = 12;
        
                 const badgeText = figma.createText();
         try {
           await figma.loadFontAsync({ family: "Inter", style: "Bold" });
           badgeText.fontName = { family: "Inter", style: "Bold" };
         } catch {
           await figma.loadFontAsync({ family: "Roboto", style: "Bold" });
           badgeText.fontName = { family: "Roboto", style: "Bold" };
         }
        badgeText.fontSize = 12;
        badgeText.characters = "ISSUES";
        badgeText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        badgeText.x = 14;
        badgeText.y = 6;
        issuesBadge.appendChild(badgeText);
        itemFrame.appendChild(issuesBadge);
        
                 // Add issue details
         const issuesText = figma.createText();
         try {
           await figma.loadFontAsync({ family: "Inter", style: "Regular" });
           issuesText.fontName = { family: "Inter", style: "Regular" };
         } catch {
           await figma.loadFontAsync({ family: "Roboto", style: "Regular" });
           issuesText.fontName = { family: "Roboto", style: "Regular" };
         }
        issuesText.fontSize = 12;
        issuesText.characters = icon.inconsistencyReasons.join(', ');
        issuesText.fills = [{ type: 'SOLID', color: { r: 1, g: 0.23, b: 0.19 } }];
        issuesText.x = 100;
        issuesText.y = 70;
        itemFrame.appendChild(issuesText);
      }
      
      mainFrame.appendChild(itemFrame);
      currentY += itemHeight + 16;
    }
    
    // Adjust main frame height
    mainFrame.resize(1200, currentY + 40);
    
    // Center the view on the new content
    figma.viewport.scrollAndZoomIntoView([mainFrame]);
    
    figma.ui.postMessage({
      type: 'review-page-created',
      data: { success: true }
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'review-page-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
}

// Add smart rename functionality
async function generateSmartIconName(node: IconNode): Promise<string> {
  try {
    // Get basic properties
    const bounds = node.absoluteBoundingBox;
    const size = bounds ? Math.max(bounds.width, bounds.height) : 24;
    
    // Analyze the icon's visual characteristics
    let suggestedName = '';
    
    // Start with existing name if it has meaningful content
    const currentName = node.name;
    if (currentName && 
        !currentName.startsWith('Frame') && 
        !currentName.startsWith('Group') && 
        !currentName.startsWith('Rectangle') &&
        !currentName.startsWith('Component') &&
        !currentName.includes('Copy')) {
      
      // Clean up the existing name
      suggestedName = currentName
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // If it's already a good name, return it
      if (suggestedName.length > 2) {
        return suggestedName;
      }
    }
    
    // Analyze frame context for hints
    const frameContext = determineFrameContext(node);
    if (frameContext) {
      const contextKeywords = {
        'Button': ['button', 'action', 'cta'],
        'Card': ['card', 'content', 'item'],
        'Navigation': ['nav', 'menu', 'link'],
        'Header': ['header', 'top', 'title'],
        'Footer': ['footer', 'bottom', 'info'],
        'Sidebar': ['side', 'panel', 'drawer'],
        'Modal': ['modal', 'dialog', 'popup'],
        'Form': ['form', 'input', 'field']
      };
      
      const keywords = contextKeywords[frameContext as keyof typeof contextKeywords];
      if (keywords) {
        suggestedName = keywords[0];
      }
    }
    
    // Analyze vector content if possible
    if ('findAll' in node) {
      const vectorNodes = node.findAll((n: any) => 
        n.type === 'VECTOR' || n.type === 'BOOLEAN_OPERATION'
      );
      
      // If it has simple vector content, suggest generic icon names
      if (vectorNodes.length > 0) {
        const shapeHints = ['icon', 'symbol', 'graphic'];
        suggestedName = suggestedName || shapeHints[0];
      }
    }
    
    // Add size information if it's a standard icon size
    const standardSizes = [16, 20, 24, 28, 32, 40, 48, 64];
    const isStandardSize = standardSizes.some(s => Math.abs(size - s) <= 1);
    
    if (isStandardSize) {
      suggestedName = suggestedName || 'icon';
      suggestedName += ` ${Math.round(size)}`;
    } else {
      suggestedName = suggestedName || `icon ${Math.round(size)}px`;
    }
    
    // Format the final name properly (camelCase)
    const formattedName = suggestedName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    
    // Ensure we have a meaningful name
    if (!formattedName || formattedName.length < 2) {
      const size = bounds ? Math.max(bounds.width, bounds.height) : 24;
      return `icon${Math.round(size)}`;
    }
    
    return formattedName;
      
  } catch (error) {
    // Handle smart name generation errors silently
    return 'icon';
  }
}

// Smart icon swapping functionality
async function swapIcons(originalIcon: IconInfo, replacementIcon: IconInfo, sizingMode: string = 'scale-to-fit', needsConversion: boolean = false): Promise<void> {
  try {
    // Validate inputs
    if (!originalIcon) {
      throw new Error('Original icon is null or undefined');
    }
    
    if (!replacementIcon) {
      throw new Error('Replacement icon is null or undefined');
    }
    
    if (!originalIcon.id) {
      throw new Error('Original icon missing ID');
    }
    
    if (!replacementIcon.id) {
      throw new Error('Replacement icon missing ID');
    }
    
    // Get the actual nodes
    const originalNode = await figma.getNodeByIdAsync(originalIcon.id);
    const replacementNode = await figma.getNodeByIdAsync(replacementIcon.id);
    
    if (!originalNode || !replacementNode) {
      throw new Error('Could not find one or both icons');
    }
    
    let originalComponent: ComponentNode;
    let isOriginalConversion = false;
    
    // Handle different types of original icons
    if (originalNode.type === 'COMPONENT') {
      originalComponent = originalNode as ComponentNode;
    } else if (originalNode.type === 'COMPONENT_SET') {
      originalComponent = (originalNode as ComponentSetNode).defaultVariant || (originalNode as ComponentSetNode).children[0] as ComponentNode;
    } else if (originalNode.type === 'INSTANCE') {
      // If original is an instance, use its master component
      const masterComponent = await (originalNode as InstanceNode).getMainComponentAsync();
      if (!masterComponent) {
        throw new Error('Instance does not have a valid master component');
      }
      originalComponent = masterComponent;

    } else {
      // Original is unresolved (frame, group, vector, etc.) - convert it first

      isOriginalConversion = true;
      
      originalComponent = figma.createComponent();
      
      // Generate proper name for original
      const originalComponentName = originalIcon.source && originalIcon.source !== 'Unknown' 
        ? `${originalIcon.source}/${originalIcon.name}`
        : `${figma.root.name}/${originalIcon.name}`;
      
      originalComponent.name = originalComponentName.replace(/[^a-zA-Z0-9\s\-_\/]/g, '');
      
      // Clone the original content
      const originalClone = (originalNode as SceneNode).clone();
      
      // Reset position of cloned content
      if ('x' in originalClone && 'y' in originalClone) {
        originalClone.x = 0;
        originalClone.y = 0;
      }
      
      // Set component size to match original
      originalComponent.resize(originalIcon.width, originalIcon.height);
      originalComponent.appendChild(originalClone);
      
      // Position in Icon Library
      let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library');
      if (!iconLibraryPage) {
        iconLibraryPage = figma.createPage();
        iconLibraryPage.name = '🎯 Icon Library';
      }
      
      // Position in grid
      const existingComponents = iconLibraryPage.children.filter(child => 
        child.type === 'COMPONENT' || child.type === 'COMPONENT_SET'
      );
      const gridX = (existingComponents.length % 8) * 120;
      const gridY = Math.floor(existingComponents.length / 8) * 120;
      
      originalComponent.x = gridX;
      originalComponent.y = gridY;
      iconLibraryPage.appendChild(originalComponent);
      
      // Replace the original node with an instance of the new component
      const newInstance = originalComponent.createInstance();
      newInstance.x = (originalNode as SceneNode).x;
      newInstance.y = (originalNode as SceneNode).y;
      
      if (originalNode.parent && 'appendChild' in originalNode.parent) {
        const parent = originalNode.parent as any;
        const index = parent.children.indexOf(originalNode);
        
        if ('insertChild' in parent) {
          parent.insertChild(index, newInstance);
        } else {
          parent.appendChild(newInstance);
        }
      }
      
      (originalNode as SceneNode).remove();
      
    }
    
    let replacementComponent: ComponentNode;
    
    if (needsConversion) {
      // Convert the replacement node to a component
      
      // Create a new component
      replacementComponent = figma.createComponent();
      
      // Generate a proper name
      const componentName = replacementIcon.source && replacementIcon.source !== 'Unknown' 
        ? `${replacementIcon.source}/${replacementIcon.name}`
        : `${figma.root.name}/${replacementIcon.name}`;
      
      replacementComponent.name = componentName.replace(/[^a-zA-Z0-9\s\-_\/]/g, '');
      
      // Clone the replacement content
      const replacementClone = (replacementNode as SceneNode).clone();
      
      // Reset position of cloned content
      if ('x' in replacementClone && 'y' in replacementClone) {
        replacementClone.x = 0;
        replacementClone.y = 0;
      }
      
      // Handle sizing based on user preference
      if (sizingMode === 'scale-to-fit') {
        // Scale the replacement to match the original icon's dimensions
        const originalWidth = originalIcon.width;
        const originalHeight = originalIcon.height;
        const scaleX = originalWidth / replacementIcon.width;
        const scaleY = originalHeight / replacementIcon.height;
        const uniformScale = Math.min(scaleX, scaleY); // Uniform scaling to fit
        
        if ('resize' in replacementClone) {
          replacementClone.resize(replacementIcon.width * uniformScale, replacementIcon.height * uniformScale);
        }
        
        // Center the scaled content if it doesn't fill the component completely
        if ('x' in replacementClone && 'y' in replacementClone) {
          const newWidth = replacementIcon.width * uniformScale;
          const newHeight = replacementIcon.height * uniformScale;
          replacementClone.x = (originalWidth - newWidth) / 2;
          replacementClone.y = (originalHeight - newHeight) / 2;
        }
        
        replacementComponent.resize(originalWidth, originalHeight);
        
      } else {
        // Keep original size - instances will be resized later
        replacementComponent.resize(replacementIcon.width, replacementIcon.height);
        
      }
      
      // Add the content to the component
      replacementComponent.appendChild(replacementClone);
      
      // Position the new component in Icon Library
      let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library');
      if (!iconLibraryPage) {
        iconLibraryPage = figma.createPage();
        iconLibraryPage.name = '🎯 Icon Library';
      }
      
      // Position in grid
      const existingComponents = iconLibraryPage.children.filter(child => 
        child.type === 'COMPONENT' || child.type === 'COMPONENT_SET'
      );
      const gridX = (existingComponents.length % 8) * 120;
      const gridY = Math.floor(existingComponents.length / 8) * 120;
      
      replacementComponent.x = gridX;
      replacementComponent.y = gridY;
      iconLibraryPage.appendChild(replacementComponent);
      
      
      
    } else {
      // Use existing component
      if (replacementNode.type !== 'COMPONENT' && replacementNode.type !== 'COMPONENT_SET') {
        throw new Error('Replacement icon must be a master component or convertible element');
      }
      
      replacementComponent = replacementNode.type === 'COMPONENT' 
        ? replacementNode as ComponentNode
        : (replacementNode as ComponentSetNode).defaultVariant || (replacementNode as ComponentSetNode).children[0] as ComponentNode;
      
      if (!replacementComponent) {
        throw new Error('Could not get component from replacement');
      }
    }
    
    // Find all instances of the original component across all pages
    const allInstances: InstanceNode[] = [];
    const instanceSearchAffectedPages = new Set<string>();
    

    
    for (const page of figma.root.children) {
      // First find all instance nodes on the page
      const allInstanceNodes = page.findAll(node => node.type === 'INSTANCE') as InstanceNode[];
      
      // Then check each instance's main component asynchronously
      let pageInstanceCount = 0;
      for (const instance of allInstanceNodes) {
        try {
          const mainComponent = await instance.getMainComponentAsync();
          if (mainComponent && mainComponent.id === originalComponent.id) {
            allInstances.push(instance);
            instanceSearchAffectedPages.add(page.name);
            pageInstanceCount++;
          }
        } catch (error) {
          // Handle main component access issues silently
        }
      }
      
    }
    
    if (allInstances.length === 0) {
    }
    
    // Create archived icons page if it doesn't exist
    let archivedPage = figma.root.children.find(page => page.name === '🗄️ Archived Icons');
    if (!archivedPage) {
      archivedPage = figma.createPage();
      archivedPage.name = '🗄️ Archived Icons';

    }
    
    // Archive the original component (move to archived page, don't delete)
    const originalComponentClone = originalComponent.clone();
    
    // Use the requested Archive/{{icon-name}} format
    const archiveName = originalComponent.name.toLowerCase().startsWith('archive/') 
      ? originalComponent.name  // Already archived, keep same name
      : `Archive/${originalComponent.name}`;
    originalComponentClone.name = archiveName;
    
    // Position archived icon in a grid
    const existingArchivedComponents = archivedPage.children.filter(child => 
      child.type === 'COMPONENT' || child.type === 'COMPONENT_SET'
    );
    const gridX = (existingArchivedComponents.length % 8) * 120;
    const gridY = Math.floor(existingArchivedComponents.length / 8) * 120;
    
    originalComponentClone.x = gridX;
    originalComponentClone.y = gridY;
    archivedPage.appendChild(originalComponentClone);
    
    
    
    // Update all instances to use the replacement component
    let successCount = 0;
    const errors: string[] = [];
    
    for (const instance of allInstances) {
      try {
        // Store the current properties before swapping
        const currentX = instance.x;
        const currentY = instance.y;
        const currentRotation = instance.rotation;
        const currentOpacity = instance.opacity;
        const currentVisible = instance.visible;
        const currentLocked = instance.locked;
        const currentConstraints = instance.constraints;
        const currentEffects = instance.effects;
        const currentBlendMode = instance.blendMode;
        const currentParent = instance.parent;
        const currentIndex = currentParent ? currentParent.children.indexOf(instance) : 0;
        
        // Create new instance from replacement component
        const newInstance = replacementComponent.createInstance();
        
        // Preserve all properties
        newInstance.x = currentX;
        newInstance.y = currentY;
        newInstance.rotation = currentRotation;
        newInstance.opacity = currentOpacity;
        newInstance.visible = currentVisible;
        newInstance.locked = currentLocked;
        newInstance.constraints = currentConstraints;
        newInstance.effects = currentEffects;
        newInstance.blendMode = currentBlendMode;
        
        // Handle sizing based on user preference and component conversion
        if (sizingMode === 'scale-to-fit' || needsConversion) {
          // For scale-to-fit or converted components, maintain original instance size
          if (Math.abs(instance.width - replacementComponent.width) > 2 || 
              Math.abs(instance.height - replacementComponent.height) > 2) {
            newInstance.resize(instance.width, instance.height);
  
          }
        } else {
          // For keep-original, instances adopt the new component's size
          // No resize needed - instance will naturally be the component's size
          
        }
        
        // Insert in the same position in parent
        if (currentParent && 'insertChild' in currentParent) {
          currentParent.insertChild(currentIndex, newInstance);
        } else if (currentParent && 'appendChild' in currentParent) {
          (currentParent as any).appendChild(newInstance);
        }
        
        // Remove the old instance
        instance.remove();
        
        successCount++;
        
      } catch (instanceError) {
        const errorMsg = `Failed to update instance: ${instanceError instanceof Error ? instanceError.message : 'Unknown error'}`;
        errors.push(errorMsg);
                  // Handle instance replacement errors silently
      }
    }
    
    // Remove the original component after all instances are updated
    originalComponent.remove();
    
    
    // Send success message
    let message: string;
    
    if (needsConversion || isOriginalConversion) {
      if (isOriginalConversion && needsConversion) {
        message = successCount > 0 
          ? `Converted both icons to components and swapped ${successCount} instances. Original archived as "${archiveName}".`
          : `Converted both icons to components and completed swap. Original archived as "${archiveName}".`;
      } else if (isOriginalConversion) {
        message = successCount > 0 
          ? `Converted "${originalIcon.name}" to component and swapped ${successCount} instances with "${replacementComponent.name}". Original archived.`
          : `Converted "${originalIcon.name}" to component and swapped with "${replacementComponent.name}". Original archived.`;
      } else {
        message = successCount > 0 
          ? `Converted "${replacementIcon.name}" to component and swapped ${successCount} instances. Original archived.`
          : `Converted "${replacementIcon.name}" to component and replaced "${originalComponent.name}". Original archived.`;
      }
    } else {
      message = successCount > 0 
        ? `Successfully swapped ${successCount} instances of "${originalComponent.name}" with "${replacementComponent.name}". Original archived.`
        : `Swapped master component "${originalComponent.name}" with "${replacementComponent.name}". Original archived.`;
    }
    
    if (sizingMode === 'keep-original' && successCount > 0) {
      message += ` Instances updated to new size (${replacementComponent.width}×${replacementComponent.height}).`;
    }
    
    // Calculate pages affected
    const swapAffectedPages = new Set<string>();
    
    // Check all instances of the original component to count pages
    const swapAllInstances = figma.root.findAllWithCriteria({
      types: ['INSTANCE']
    });
    
    swapAllInstances.forEach(instance => {
      if (instance.mainComponent?.id === originalComponent.id) {
        // Find the page this instance is on
        let pageNode = instance.parent;
        while (pageNode && pageNode.type !== 'PAGE') {
          pageNode = pageNode.parent;
        }
        if (pageNode && pageNode.type === 'PAGE') {
          swapAffectedPages.add(pageNode.name);
        }
      }
    });
    
    // Also include the page where the master component was
    let masterPageNode = originalComponent.parent;
    while (masterPageNode && masterPageNode.type !== 'PAGE') {
      masterPageNode = masterPageNode.parent;
    }
    if (masterPageNode && masterPageNode.type === 'PAGE') {
      swapAffectedPages.add(masterPageNode.name);
    }
    
    figma.ui.postMessage({
      type: 'icon-swap-complete',
      data: { 
        message: message,
        successCount: successCount,
        errorCount: errors.length,
        errors: errors.slice(0, 3), // Only show first 3 errors
        converted: needsConversion,
        newComponentName: replacementComponent.name,
        instancesUpdated: successCount,
        pagesAffected: swapAffectedPages.size
      }
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'icon-swap-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case 'scan-icons':
      try {
        const result = await scanForIcons();
        figma.ui.postMessage({
          type: 'scan-complete',
          data: result
        });
              } catch (error) {
          figma.ui.postMessage({
            type: 'scan-error',
            data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
          });
        }
      break;
      
    case 'select-icon':
      try {
        const node = await figma.getNodeByIdAsync(msg.iconId);
        if (node) {
          // Check if the node is on the current page
          const nodePage = node.parent;
          let pageNode = nodePage;
          
          // Traverse up to find the page
          while (pageNode && pageNode.type !== 'PAGE') {
            pageNode = pageNode.parent;
          }
          
          if (pageNode && pageNode.type === 'PAGE') {
            // Switch to the node's page if it's different from current page
            if (pageNode.id !== figma.currentPage.id) {
              figma.currentPage = pageNode as PageNode;
              // Give it a moment to switch pages
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Now select the node
            figma.currentPage.selection = [node as SceneNode];
            figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
          }
        }
      } catch (error) {
        // Silently handle selection errors
      }
      break;
      
    case 'consolidate-icons':
      await consolidateSimilarIcons(msg.icons, msg.scope, msg.currentPageName);
      break;
      
    case 'consolidate-library-duplicates':
      await consolidateLibraryDuplicates(msg.icons, msg.currentPageName);
      break;
      
    case 'create-review-page':
      await createReviewPage(msg.icons);
      break;
      
    case 'smart-rename-icon':
      try {
        const node = await figma.getNodeByIdAsync(msg.iconId);
        if (node) {
          const smartName = await generateSmartIconName(node as IconNode);
          (node as SceneNode).name = smartName;
          
          figma.ui.postMessage({
            type: 'icon-renamed',
            data: { 
              iconId: msg.iconId, 
              newName: smartName,
              message: `Renamed to "${smartName}"`
            }
          });
        } else {
          throw new Error('Icon not found');
        }
      } catch (error) {
        figma.ui.postMessage({
          type: 'rename-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'set-relaunch-data':
      try {
        const node = await figma.getNodeByIdAsync(msg.iconId);
        if (node) {
          // Set relaunch data to allow users to use Figma's built-in rename feature
          (node as SceneNode).setRelaunchData({ 
            rename: 'Use Figma AI to rename this icon'
          });
          
          figma.ui.postMessage({
            type: 'relaunch-set',
            data: { 
              message: 'Right-click the icon and select "Rename" to use Figma AI'
            }
          });
        }
      } catch (error) {
        figma.ui.postMessage({
          type: 'relaunch-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'swap-icons':
      try {
        await swapIcons(msg.originalIcon, msg.replacementIcon, msg.sizingMode, msg.needsConversion);
      } catch (error) {
        figma.ui.postMessage({
          type: 'icon-swap-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error in swap handler' }
        });
      }
      break;
      
    case 'get-onboarding-state':
      try {
        // Get onboarding state from Figma's persistent storage
        const onboardingCompleted = await figma.clientStorage.getAsync('onboardingCompleted');
        figma.ui.postMessage({
          type: 'onboarding-state',
          data: { completed: onboardingCompleted === true }
        });
      } catch (error) {
        // If there's an error reading storage, assume onboarding hasn't been completed
        figma.ui.postMessage({
          type: 'onboarding-state',
          data: { completed: false }
        });
      }
      break;
      
    case 'set-onboarding-complete':
      try {
        // Store onboarding completion state in Figma's persistent storage
        await figma.clientStorage.setAsync('onboardingCompleted', msg.completed);
      } catch (error) {
        // Silently handle storage errors
      }
      break;
      
    case 'cancel':
  figma.closePlugin();
      break;
      
    default:
      // Ignore unknown message types
  }
};

// Track current page for automatic rescanning
let lastKnownPageId = figma.currentPage.id;
let pageChangeTimer: any = null;

// Listen for selection changes on canvas and sync with UI
figma.on("selectionchange", () => {
  // Check if page has changed
  if (figma.currentPage.id !== lastKnownPageId) {
    lastKnownPageId = figma.currentPage.id;
    
    // Clear any existing timer to debounce rapid page changes
    if (pageChangeTimer) {
      clearTimeout(pageChangeTimer);
    }
    
    // Notify UI immediately that page changed
    figma.ui.postMessage({
      type: 'page-changed-scanning',
      data: { 
        newPageName: figma.currentPage.name,
        message: 'Page changed - scanning icons...'
      }
    });
    
    // Debounce the actual scan to handle rapid page switching
    pageChangeTimer = setTimeout(async () => {
      try {
        const result = await scanForIcons();
        figma.ui.postMessage({
          type: 'scan-complete',
          data: { ...result, autoScan: true }
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'scan-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      pageChangeTimer = null;
    }, 300); // 300ms debounce to handle rapid page switching
  }
  
  // Handle selection changes
  const selection = figma.currentPage.selection;
  if (selection.length === 1) {
    const selectedNode = selection[0];
    figma.ui.postMessage({
      type: 'canvas-selection-changed',
      data: { nodeId: selectedNode.id }
    });
  } else {
    figma.ui.postMessage({
      type: 'canvas-selection-changed',
      data: { nodeId: null }
    });
  }
});
