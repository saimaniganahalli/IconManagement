// Figma Icon Management Plugin
// Discovers, analyzes, and consolidates icons across a Figma file

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { 
  width: 800, 
  height: 800
});

// Types for icon data and markings
interface IconMarkings {
  [iconId: string]: {
    isIgnored?: boolean;
    isMarkedForSwap?: boolean;
  };
}

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
  variantData?: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    preview?: string;
    fills?: readonly Paint[];
    strokes?: readonly Paint[];
  }>; // For component sets, stores all variant information
  fills?: readonly Paint[];
  strokes?: readonly Paint[];
  isNew?: boolean; // Newly created or detached icon
  isDuplicate?: boolean; // Has duplicates on the same page
  isIgnored?: boolean; // User marked this icon to ignore
  isMarkedForSwap?: boolean; // User marked this icon for batch swapping
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
    'file', 'folder', 'document', 'image', 'video', 'audio', 'chart', 'graph',
    // Additional common icons
    'avatar', 'profile', 'account', 'contact', 'person', 'people', 'team',
    'notification', 'alert', 'message', 'chat', 'comment', 'feedback',
    'dashboard', 'analytics', 'stats', 'report', 'data', 'database',
    'cloud', 'server', 'network', 'wifi', 'bluetooth', 'mobile', 'desktop',
    'tablet', 'device', 'hardware', 'software', 'app', 'application',
    'website', 'web', 'link', 'url', 'external', 'internal', 'anchor',
    'bookmark', 'favorite', 'like', 'love', 'heart', 'thumbs', 'rating',
    'cart', 'shopping', 'store', 'shop', 'buy', 'sell', 'payment', 'credit',
    'card', 'money', 'dollar', 'price', 'cost', 'invoice', 'receipt',
    // Shape-based icons
    'circle', 'square', 'triangle', 'diamond', 'polygon', 'shape',
    'dot', 'bullet', 'marker', 'pointer', 'cursor', 'target', 'crosshair',
    // Social media and brands
    'facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'tiktok',
    'github', 'gitlab', 'slack', 'discord', 'telegram', 'whatsapp',
    // Integration services and platforms
    'google', 'microsoft', 'apple', 'amazon', 'aws', 'azure', 'meta',
    'dropbox', 'spotify', 'netflix', 'adobe', 'figma', 'sketch', 'canva',
    'zoom', 'teams', 'skype', 'webex', 'notion', 'confluence', 'jira',
    'trello', 'asana', 'monday', 'clickup', 'basecamp', 'linear',
    'salesforce', 'hubspot', 'mailchimp', 'constant', 'sendinblue',
    'stripe', 'paypal', 'square', 'shopify', 'woocommerce', 'magento',
    'wordpress', 'drupal', 'squarespace', 'wix', 'webflow',
    // Browsers and tools  
    'chrome', 'firefox', 'safari', 'edge', 'opera', 'brave', 'vivaldi',
    'android', 'ios', 'windows', 'macos', 'linux', 'ubuntu',
    // Development and productivity
    'vscode', 'atom', 'sublime', 'intellij', 'pycharm', 'eclipse',
    'docker', 'kubernetes', 'jenkins', 'travis', 'circleci', 'gitlab-ci',
    'npm', 'yarn', 'pip', 'composer', 'maven', 'gradle',
    // Communication and collaboration
    'intercom', 'zendesk', 'freshworks', 'helpscout', 'crisp',
    'calendly', 'acuity', 'booking', 'doodle', 'when2meet',
    // Analytics and tracking
    'analytics', 'mixpanel', 'amplitude', 'hotjar', 'fullstory',
    'segment', 'optimizely', 'ab-test', 'firebase', 'supabase',
    // Status and states
    'loading', 'spinner', 'progress', 'complete', 'done', 'finished',
    'pending', 'waiting', 'active', 'inactive', 'disabled', 'enabled',
    'online', 'offline', 'connected', 'disconnected', 'sync', 'synced',
    // Library patterns (common icon library prefixes)
    'lucide', 'heroicons', 'feather', 'material', 'fontawesome', 'bootstrap',
    'tabler', 'phosphor', 'remix', 'ant', 'carbon', 'fluent', 'eva'
  ];
  
  return iconKeywords.some(keyword => name.includes(keyword));
}

// Icon marking storage functions
async function saveIconMarkings(markings: IconMarkings): Promise<void> {
  try {
    await figma.clientStorage.setAsync('iconMarkings', markings);
  } catch (error) {
    // Silently handle storage errors
  }
}

async function loadIconMarkings(): Promise<IconMarkings> {
  try {
    const markings = await figma.clientStorage.getAsync('iconMarkings');
    return markings || {};
  } catch (error) {
    return {};
  }
}

async function markIcon(iconId: string, type: 'ignore' | 'swap' | 'unmark'): Promise<void> {
  try {
    const markings = await loadIconMarkings();
    
    if (type === 'unmark') {
      // Remove all markings for this icon
      delete markings[iconId];
    } else {
      // Set the specific marking
      markings[iconId] = {
        isIgnored: type === 'ignore',
        isMarkedForSwap: type === 'swap'
      };
    }
    
    await saveIconMarkings(markings);
  } catch (error) {
    throw new Error('Failed to mark icon: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

async function clearAllMarkings(): Promise<void> {
  try {
    await figma.clientStorage.setAsync('iconMarkings', {});
  } catch (error) {
    throw new Error('Failed to clear markings: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }
}

async function applyMarkingsToIcons(icons: IconInfo[]): Promise<IconInfo[]> {
  const markings = await loadIconMarkings();
  
  return icons.map(icon => ({
    ...icon,
    isIgnored: markings[icon.id]?.isIgnored || false,
    isMarkedForSwap: markings[icon.id]?.isMarkedForSwap || false
  }));
}

function getMarkingMessage(markType: string): string {
  switch (markType) {
    case 'ignore': return 'Icon marked to ignore';
    case 'swap': return 'Icon marked for swap';
    case 'unmark': return 'Icon markings removed';
    default: return 'Icon marking updated';
  }
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
      
      // Standard icon sizes
      const commonSizes = [16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 96, 128];
      if (commonSizes.some(s => Math.abs(size - s) <= 2)) {
        score += 25;
      }
      
      // Reasonable icon size range
      if (size >= 12 && size <= 128) {
        score += 20;
      } else if (size < 8 || size > 256) {
        score -= 30; // Penalize very small or very large elements
      }
    }
    
    // Context-based scoring
    const frameContext = determineFrameContext(node);
    if (frameContext) {
      score += 15; // Icons often appear in specific UI contexts
    }
    
    // Type-based scoring
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      score += 30; // Components are likely to be reusable icons
    } else if (node.type === 'INSTANCE') {
      score += 25; // Instances suggest reusable components
    } else if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
      score += 15; // Vector graphics are often icons
    } else if (node.type === 'GROUP') {
      score += 10; // Groups might contain icon elements
    }
    
    // Content analysis for frames and groups
    if (node.type === 'FRAME' || node.type === 'GROUP') {
      const children = 'children' in node ? node.children : [];
      const vectorChildren = children.filter(child => 
        child.type === 'VECTOR' || 
        child.type === 'BOOLEAN_OPERATION' ||
        child.type === 'ELLIPSE' ||
        child.type === 'RECTANGLE' ||
        child.type === 'POLYGON' ||
        child.type === 'STAR'
      );
      
      if (vectorChildren.length > 0) {
        score += Math.min(vectorChildren.length * 10, 30); // Bonus for vector content
      }
      
      // Penalize frames with many text children (likely not icons)
      const textChildren = children.filter(child => child.type === 'TEXT');
      if (textChildren.length > 2) {
        score -= textChildren.length * 5;
      }
      
      // Penalize frames with many children (likely complex UI, not icons)
      if (children.length > 10) {
        score -= (children.length - 10) * 2;
      }
    }
    
    return Math.max(0, score); // Ensure score is never negative
  } catch (error) {
    return 0;
  }
}

function isLikelyIcon(node: IconNode): boolean {
  try {
    const bounds = node.absoluteBoundingBox;
    if (!bounds) {
      console.log(`    🔍 isLikelyIcon: No bounds for "${node.name}"`);
      return false;
    }
    
    const aspectRatio = bounds.width / bounds.height;
    const size = Math.max(bounds.width, bounds.height);
    const name = node.name.toLowerCase();
    
    console.log(`    🔍 isLikelyIcon: "${node.name}" - size: ${size}, aspect: ${aspectRatio.toFixed(2)}, type: ${node.type}`);
    
    // PRIORITY 1: Component/ComponentSet icons - MUCH MORE PERMISSIVE
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      console.log(`    🔍 Checking component/set: "${node.name}"`);
      
      // Only exclude obvious UI components by name
      const isUIComponent = name.includes('button') || 
                           name.includes('input') || 
                           name.includes('card') || 
                           name.includes('modal') || 
                           name.includes('dialog') || 
                           name.includes('form') || 
                           name.includes('banner') || 
                           name.includes('navbar') || 
                           name.includes('header') || 
                           name.includes('footer') || 
                           name.includes('sidebar');
      
      if (isUIComponent) {
        console.log(`    ❌ Rejected as UI component: "${node.name}"`);
        return false;
      }
      
      // Very permissive size filtering - only reject extremely large components
      if (size > 500) {
        console.log(`    ❌ Rejected for large size: ${size}px`);
        return false;
      }
      
      // Very permissive aspect ratio - only reject extremely stretched components
      if (aspectRatio < 0.1 || aspectRatio > 10) {
        console.log(`    ❌ Rejected for extreme aspect ratio: ${aspectRatio.toFixed(2)}`);
        return false;
      }
      
      // Component sets are almost always icon libraries - be super permissive
      if (node.type === 'COMPONENT_SET') {
        console.log(`    ✅ Accepted as component set: "${node.name}"`);
        return true; // Accept all component sets that aren't UI components
      }
      
      // For regular components, check for icon-like characteristics
      let score = 0;
      
      // Check for icon-like naming
      const hasIconName = name.includes('icon') || 
                         name.includes('/') || 
                         isIconComponent(node);
      
      // Icon Management components
      const isFromIconManagement = name.toLowerCase().startsWith('icon/');
      
      if (hasIconName || isFromIconManagement) {
        score += 3;
        console.log(`    ✅ Icon name bonus: +3 (score: ${score})`);
      }
      
      // Size-based scoring - more permissive
      if (size >= 8 && size <= 200) {
        score += 2;
        console.log(`    ✅ Good size bonus: +2 (score: ${score})`);
      } else if (size >= 8 && size <= 500) {
        score += 1;
        console.log(`    ✅ Okay size bonus: +1 (score: ${score})`);
      }
      
      // Aspect ratio scoring - more permissive
      if (aspectRatio >= 0.5 && aspectRatio <= 2.0) {
        score += 1;
        console.log(`    ✅ Good aspect ratio bonus: +1 (score: ${score})`);
      }
      
      // Vector content bonus
      const hasVectorContent = node.findChild && node.findChild(child => 
        child.type === 'VECTOR' || 
        child.type === 'BOOLEAN_OPERATION' ||
        child.type === 'GROUP' ||
        child.type === 'ELLIPSE' ||
        child.type === 'RECTANGLE' ||
        child.type === 'POLYGON' ||
        child.type === 'STAR'
      );
      if (hasVectorContent) {
        score += 1;
        console.log(`    ✅ Vector content bonus: +1 (score: ${score})`);
      }
      
      // Lower threshold for regular components
      const result = score >= 2;
      console.log(`    📊 Final score: ${score}, result: ${result ? '✅ ACCEPTED' : '❌ REJECTED'}`);
      return result;
    }
    
    // PRIORITY 2: Instance icons (with UI component filtering)
    if (node.type === 'INSTANCE') {
      // First check: Exclude obvious UI component instances by name
      const isUIComponent = name.includes('button') || 
                           name.includes('input') || 
                           name.includes('card') || 
                           name.includes('modal') || 
                           name.includes('dialog') || 
                           name.includes('dropdown') || 
                           name.includes('select') || 
                           name.includes('checkbox') || 
                           name.includes('radio') || 
                           name.includes('toggle') || 
                           name.includes('switch') || 
                           name.includes('slider') || 
                           name.includes('navbar') || 
                           name.includes('header') || 
                           name.includes('footer') || 
                           name.includes('sidebar') || 
                           name.includes('menu') || 
                           name.includes('tab') || 
                           name.includes('badge') || 
                           name.includes('chip') || 
                           name.includes('avatar') || 
                           name.includes('form') || 
                           name.includes('field') || 
                           name.includes('banner') || 
                           name.includes('alert') || 
                           name.includes('notification');
      
      if (isUIComponent) {
        return false; // Definitely not an icon
      }
      
      // Second check: Size and aspect ratio filtering (more restrictive for instances)
      // Instances larger than 80px are rarely icons, UNLESS they have clear icon naming
      const hasIconName = name.includes('icon') || 
                         name.includes('/') || // Library pattern like "Icon/home"
                         isIconComponent(node); // Keyword detection
      
      // Special case: Always allow instances that start with "Icon/" (from our add icon feature)
      const isFromIconManagement = name.toLowerCase().startsWith('icon/');
      
      if (size > 80 && !hasIconName && !isFromIconManagement) {
        return false; // Only reject large instances that don't have icon-like names
      }
      
      // Extra large icons (>200px) should only be allowed if they're clearly from Icon Management
      if (size > 200 && !isFromIconManagement) {
        return false;
      }
      
      // More restrictive aspect ratio for instances, but be more lenient for clear icon instances
      if (hasIconName || isFromIconManagement) {
        // More permissive for instances with icon naming (e.g. Icon/home)
        if (aspectRatio < 0.5 || aspectRatio > 2.0) {
          return false;
        }
      } else {
        // Stricter for instances without clear icon naming
        if (aspectRatio < 0.75 || aspectRatio > 1.33) {
          return false;
        }
      }
      
      // Third check: Look for icon-like characteristics (slightly more lenient for instances)
      let score = 0;
      
      // Positive indicators for icons
      if (hasIconName) {
        score += 3;
      }
      
      // Extra points for instances from Icon Management plugin
      if (isFromIconManagement) {
        score += 2; // Ensures these always get detected
      }
      
      // Perfect square gets bonus points (most icons are square)
      if (aspectRatio >= 0.95 && aspectRatio <= 1.05) {
        score += 2;
      }
      
      // Standard icon sizes get bonus points
      const commonIconSizes = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80];
      if (commonIconSizes.some(s => Math.abs(bounds.width - s) <= 2 && Math.abs(bounds.height - s) <= 2)) {
        score += 2;
      }
      
      // Small size suggests icon (most icons are under 48px)
      if (size <= 48) {
        score += 1;
      }
      
      // Instances need a slightly lower score threshold since they might not have all icon characteristics
      return score >= 2;
    }
    
    // PRIORITY 3: Square frame icons - detect standard icon-sized square frames
    if (node.type === 'FRAME') {
      // Must be square-ish (more permissive than before)
      if (aspectRatio < 0.7 || aspectRatio > 1.43) {
        return false;
      }
      
      // Check size ranges instead of exact sizes - be more permissive
      const isSmallIcon = size >= 8 && size <= 32;   // Small icons (8-32px)
      const isMediumIcon = size >= 28 && size <= 64; // Medium icons (28-64px) 
      const isLargeIcon = size >= 56 && size <= 128; // Large icons (56-128px)
      
      if (!isSmallIcon && !isMediumIcon && !isLargeIcon) {
        return false;
      }
      
      // Scoring system instead of hard requirements
      let score = 0;
      
      // Perfect square gets bonus points
      if (aspectRatio >= 0.95 && aspectRatio <= 1.05) {
        score += 2;
      }
      
      // Standard icon sizes get bonus points
      const commonIconSizes = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 128];
      if (commonIconSizes.some(s => Math.abs(bounds.width - s) <= 2 && Math.abs(bounds.height - s) <= 2)) {
        score += 2;
      }
      
      // Icon-like naming gets bonus points
      const hasIconName = name.includes('icon') || 
                         name.includes('/') || // Library pattern
                         isIconComponent(node); // Use existing keyword detection
      if (hasIconName) {
        score += 2;
      }
      
      // Vector content gets bonus points
      const hasVectorContent = node.findChild(child => 
        child.type === 'VECTOR' || 
        child.type === 'BOOLEAN_OPERATION' ||
        child.type === 'GROUP' ||
        child.type === 'ELLIPSE' ||
        child.type === 'RECTANGLE' ||
        child.type === 'POLYGON' ||
        child.type === 'STAR'
      );
      if (hasVectorContent) {
        score += 2;
      }
      
      // Single child that fills the frame (likely an icon)
      if (node.children.length === 1) {
        const child = node.children[0];
        const childBounds = child.absoluteBoundingBox;
        if (childBounds) {
          const fillsFrame = Math.abs(childBounds.width - bounds.width) < 4 && 
                           Math.abs(childBounds.height - bounds.height) < 4;
          if (fillsFrame) {
            score += 1;
          }
        }
      }
      
      // Simple content (few children) suggests icon-like structure
      if (node.children.length <= 3) {
        score += 1;
      }
      
      // Return true if score meets threshold (more lenient than before)
      return score >= 3; // Reduced from implicit score of 6+ to 3+
    }
    
    // PRIORITY 4: Direct vector/group icons - slightly more permissive
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'GROUP') {
      // Check if this node is inside a frame that could be an icon
      let parent = node.parent;
      while (parent && parent.type !== 'PAGE') {
        if (parent.type === 'FRAME') {
          const parentBounds = parent.absoluteBoundingBox;
          if (parentBounds) {
            const parentAspect = parentBounds.width / parentBounds.height;
            // If parent frame is square-ish and icon-sized, skip this vector
            if (parentAspect >= 0.75 && parentAspect <= 1.33 && 
                Math.max(parentBounds.width, parentBounds.height) <= 80) {
              return false;
            }
          }
        }
        parent = parent.parent;
      }
      
      // More permissive requirements for standalone vectors
      if (aspectRatio >= 0.75 && aspectRatio <= 1.33 && 
          size >= 12 && size <= 64 && 
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
  // Create a map of master component IDs to their instance counts
  const instanceCounts = new Map<string, number>();
  
  icons.forEach(icon => {
    if (icon.masterComponentId) {
      instanceCounts.set(icon.masterComponentId, (instanceCounts.get(icon.masterComponentId) || 0) + 1);
    }
  });
  
  // Update master components with their instance counts
  return icons.map(icon => {
    if (icon.status === 'master') {
      return {
        ...icon,
        instanceCount: instanceCounts.get(icon.id) || 0
      };
    }
    return icon;
  });
}

async function consolidateSimilarIcons(icons: IconInfo[], scope: string = 'all-pages', currentPageName?: string): Promise<void> {
  try {
    figma.ui.postMessage({
      type: 'consolidation-progress',
      data: { percentage: 0, message: 'Starting consolidation...' }
    });

    // Filter icons based on scope
    let iconsToProcess = icons.filter(icon => icon.status === 'unresolved');
    if (scope === 'current-page' && currentPageName) {
      iconsToProcess = iconsToProcess.filter(icon => icon.page === currentPageName);
    }

    if (iconsToProcess.length === 0) {
      figma.ui.postMessage({
        type: 'consolidation-complete',
        data: { 
          componentsCreated: 0,
          iconsReplaced: 0,
          pagesAffected: 0,
          message: 'No unresolved icons found to consolidate.'
        }
      });
      return;
    }

    // Group similar icons by normalized name and size
    const iconGroups = new Map<string, IconInfo[]>();
    
    iconsToProcess.forEach(icon => {
      const normalizedName = icon.name.toLowerCase()
        .replace(/[-_\s\.]/g, '')
        .replace(/\d+/g, '')
        .replace(/(icon|svg|vector|graphic|outline|filled|solid)/g, '')
        .replace(/[^a-z]/g, '');
      
      const sizeGroup = `${Math.round(icon.width/8)*8}x${Math.round(icon.height/8)*8}`;
      const groupKey = `${normalizedName}_${sizeGroup}_${icon.source}`;
      
      if (!iconGroups.has(groupKey)) {
        iconGroups.set(groupKey, []);
      }
      iconGroups.get(groupKey)!.push(icon);
    });

    let componentsCreated = 0;
    let iconsReplaced = 0;
    const pagesAffected = new Set<string>();
    let processed = 0;

    // Only process groups with multiple similar icons
    const groupsToProcess = Array.from(iconGroups.entries()).filter(([, group]) => group.length > 1);
    
    if (groupsToProcess.length === 0) {
      figma.ui.postMessage({
        type: 'consolidation-complete',
        data: { 
          componentsCreated: 0,
          iconsReplaced: 0,
          pagesAffected: 0,
          message: 'No similar icons found to consolidate.'
        }
      });
      return;
    }

    // First, check if Icon Library page exists, if not create it
    let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library') as PageNode;
    if (!iconLibraryPage) {
      iconLibraryPage = figma.createPage();
      iconLibraryPage.name = '🎯 Icon Library';
    }

    for (const [groupKey, group] of groupsToProcess) {
      try {
        figma.ui.postMessage({
          type: 'consolidation-progress',
          data: { 
            percentage: (processed / groupsToProcess.length) * 90,
            message: `Processing group ${processed + 1}/${groupsToProcess.length}...`
          }
        });

        // Find the best representative icon (prefer ones with better names)
        const bestIcon = group.reduce((best, current) => {
          const currentScore = current.name.length + (current.name.includes('icon') ? 10 : 0);
          const bestScore = best.name.length + (best.name.includes('icon') ? 10 : 0);
          return currentScore > bestScore ? current : best;
        });

        // Get the original node
        const originalNode = await figma.getNodeByIdAsync(bestIcon.id);
        if (!originalNode || originalNode.type === 'PAGE') {
          continue;
        }

        // Clone the node content
        const clonedNode = (originalNode as any).clone();
        
        // Convert to component if it isn't already
        let component: ComponentNode;
        if (clonedNode.type === 'COMPONENT') {
          component = clonedNode;
          iconLibraryPage.appendChild(component);
        } else {
          // Create component from the cloned node
          component = figma.createComponent();
          component.name = await generateSmartIconName(clonedNode as IconNode);
          component.resize(clonedNode.width, clonedNode.height);
          
          // Reset clone position to (0,0) relative to component
          if ('x' in clonedNode && 'y' in clonedNode) {
            clonedNode.x = 0;
            clonedNode.y = 0;
          }
          
          // Add the cloned content to the component
          component.appendChild(clonedNode);
          
          // Add the completed component to the icon library page
          iconLibraryPage.appendChild(component);
          
          // DON'T remove clonedNode - it's now the content of the component!
        }
        
        // Position the component in a grid on the icon library page
        const gridSize = 80; // Space between icons
        const iconsPerRow = 10;
        const row = Math.floor(componentsCreated / iconsPerRow);
        const col = componentsCreated % iconsPerRow;
        
        component.x = col * gridSize;
        component.y = row * gridSize;
        
        componentsCreated++;

        // Replace all icons in the group with instances of the new component
        // IMPORTANT: Don't try to replace the icon we used to create the component
        for (const iconToReplace of group) {
          // Skip the icon that was used as the source for creating the component
          if (iconToReplace.id === bestIcon.id) {
            console.log(`Skipping replacement of source icon: ${iconToReplace.name} (used to create component)`);
            
            // Instead, just remove the original source icon since we cloned it to create the component
            try {
              const sourceNode = await figma.getNodeByIdAsync(iconToReplace.id);
              if (sourceNode && sourceNode.type !== 'PAGE' && sourceNode.type !== 'COMPONENT') {
                console.log(`Removing original source node: ${iconToReplace.name}`);
                sourceNode.remove();
                iconsReplaced++;
                pagesAffected.add(iconToReplace.page);
              }
            } catch (sourceRemoveError) {
              console.error(`Failed to remove source node ${iconToReplace.name}:`, sourceRemoveError);
            }
            continue;
          }
          
          try {
            await replaceWithInstance(iconToReplace, component);
            iconsReplaced++;
            pagesAffected.add(iconToReplace.page);
            console.log(`Successfully replaced ${iconToReplace.name} with instance`);
          } catch (replaceError) {
            console.error(`Failed to replace ${iconToReplace.name}:`, replaceError);
            
            // If replaceWithInstance fails, manually try to remove the original node to prevent empty frames
            try {
              const failedNode = await figma.getNodeByIdAsync(iconToReplace.id);
              if (failedNode && failedNode.type !== 'PAGE') {
                console.log(`Manually removing failed node: ${iconToReplace.name}`);
                failedNode.remove();
                iconsReplaced++; // Count manual removals too
                pagesAffected.add(iconToReplace.page);
              }
            } catch (manualRemoveError) {
              console.error(`Failed to manually remove ${iconToReplace.name}:`, manualRemoveError);
            }
          }
        }

      } catch (groupError) {
        // Continue with next group if this one fails
      }
      
      processed++;
    }

    figma.ui.postMessage({
      type: 'consolidation-complete',
      data: { 
        componentsCreated,
        iconsReplaced,
        pagesAffected: pagesAffected.size,
        message: `Consolidation complete! Created ${componentsCreated} new components and replaced ${iconsReplaced} icons.`
      }
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'consolidation-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
}

async function replaceWithInstance(icon: IconInfo, component: ComponentNode): Promise<void> {
  try {
    // Get the original node
    const originalNode = await figma.getNodeByIdAsync(icon.id);
    if (!originalNode || originalNode.type === 'PAGE') {
      throw new Error(`Original node not found or is a page: ${icon.name}`);
    }

    // Validate that the node is replaceable
    if (originalNode.type === 'COMPONENT' || originalNode.type === 'COMPONENT_SET') {
      console.log(`Skipping replacement of master component: ${icon.name}`);
      return; // Don't replace master components
    }

    console.log(`Replacing ${icon.name} (${originalNode.type}) with instance of ${component.name}`);

    // Store position and properties safely
    const nodeProperties = originalNode as any;
    const x = nodeProperties.x || 0;
    const y = nodeProperties.y || 0;
    const rotation = nodeProperties.rotation || 0;
    const opacity = nodeProperties.opacity !== undefined ? nodeProperties.opacity : 1;
    const visible = nodeProperties.visible !== undefined ? nodeProperties.visible : true;
    
    const parent = originalNode.parent;
    const index = parent && 'children' in parent ? parent.children.indexOf(originalNode as any) : 0;

    // Validate parent exists and can contain children
    if (!parent || !('appendChild' in parent)) {
      throw new Error(`Invalid parent for ${icon.name}`);
    }

    // Create instance
    const instance = component.createInstance();
    
    // Apply stored properties
    instance.x = x;
    instance.y = y;
    instance.rotation = rotation;
    instance.opacity = opacity;
    instance.visible = visible;

    // Insert at the same position in the parent
    if ('insertChild' in parent && index >= 0) {
      parent.insertChild(index, instance);
    } else {
      parent.appendChild(instance);
    }

    // Remove the original node - this is critical to prevent empty frames
    originalNode.remove();
    console.log(`Successfully removed original node: ${icon.name}`);

  } catch (error) {
    throw new Error(`Failed to replace icon ${icon.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function consolidateLibraryDuplicates(icons: IconInfo[], currentPageName: string): Promise<void> {
  try {
    figma.ui.postMessage({
      type: 'library-consolidation-progress',
      data: { percentage: 0, message: 'Analyzing library duplicates with priority hierarchy...' }
    });

    // Get ALL icons on the Icon Library page (components, instances, frames)
    const libraryIcons = icons.filter(icon => icon.page === currentPageName);

    if (libraryIcons.length === 0) {
      figma.ui.postMessage({
        type: 'library-consolidation-complete',
        data: { 
          duplicatesRemoved: 0,
          message: 'No icons found in the Icon Library.'
        }
      });
      return;
    }

    // Group ALL icons by similarity (normalized name + size)
    const duplicateGroups = new Map<string, IconInfo[]>();
    
    libraryIcons.forEach(icon => {
      const basePattern = icon.name.toLowerCase()
        .replace(/[-_\s\.]/g, '')
        .replace(/\d+/g, '')
        .replace(/\s*copy\s*\d*/i, '')
        .trim();
      const sizeKey = `${Math.round(icon.width/4)*4}x${Math.round(icon.height/4)*4}`; // 4px tolerance
      const groupKey = `${basePattern}_${sizeKey}`;
      
      if (!duplicateGroups.has(groupKey)) {
        duplicateGroups.set(groupKey, []);
      }
      duplicateGroups.get(groupKey)!.push(icon);
    });

    let duplicatesRemoved = 0;
    let processed = 0;
    const errors: string[] = [];
    
    // Only process groups with multiple items (potential duplicates)
    const groupsToProcess = Array.from(duplicateGroups.entries()).filter(([, group]) => group.length > 1);

    for (const [groupKey, group] of groupsToProcess) {
      try {
        figma.ui.postMessage({
          type: 'library-consolidation-progress',
          data: { 
            percentage: (processed / groupsToProcess.length) * 90,
            message: `Processing group ${processed + 1}/${groupsToProcess.length}...`
          }
        });

        // Apply priority hierarchy: Components > Instances > Frames
        // NEVER delete master components - they have highest priority
        const components = group.filter(icon => icon.status === 'master' || icon.type === 'COMPONENT');
        const instances = group.filter(icon => icon.status === 'instance' || icon.type === 'INSTANCE');
        const frames = group.filter(icon => icon.status === 'unresolved' || (icon.type === 'FRAME' || icon.type === 'GROUP' || icon.type === 'VECTOR'));

        console.log(`Group ${groupKey}: ${components.length} components, ${instances.length} instances, ${frames.length} frames`);

        // If we have master components, they take priority
        if (components.length > 0) {
          // Keep ALL components (never delete master components)
          // Delete instances and frames that are duplicates
          
          // Choose the best component as the canonical one (for instances to reference)
          const canonicalComponent = components.reduce((best, current) => {
            // Prefer cleaner names without "copy"
            const currentScore = current.name.length + (current.name.toLowerCase().includes('copy') ? 100 : 0);
            const bestScore = best.name.length + (best.name.toLowerCase().includes('copy') ? 100 : 0);
            return currentScore < bestScore ? current : best;
          });

          // Get the canonical component node
          const canonicalNode = await figma.getNodeByIdAsync(canonicalComponent.id);
          if (!canonicalNode || (canonicalNode.type !== 'COMPONENT' && canonicalNode.type !== 'COMPONENT_SET')) {
            errors.push(`Canonical component not found or invalid: ${canonicalComponent.name}`);
            continue;
          }
          const canonicalComponentNode = canonicalNode as ComponentNode;

          // Only remove instances that are truly duplicates, not legitimate instances
          for (const instanceIcon of instances) {
            try {
              const instanceNode = await figma.getNodeByIdAsync(instanceIcon.id);
              if (!instanceNode || instanceNode.type !== 'INSTANCE') {
                errors.push(`Instance not found or invalid: ${instanceIcon.name}`);
                continue;
              }

              const instance = instanceNode as InstanceNode;
              
              // Check if this instance is already pointing to our canonical component
              const masterComponent = await instance.getMainComponentAsync();
              if (masterComponent && masterComponent.id === canonicalComponent.id) {
                // This is a legitimate instance of the canonical component - DON'T remove it
                console.log(`Keeping legitimate instance: ${instanceIcon.name} (instance of ${canonicalComponent.name})`);
                continue;
              }
              
              // Only remove instances that point to different master components (true duplicates)
              if (masterComponent) {
                // Check if the master component is also in our components list (different master)
                const isDuplicateMaster = components.some(comp => comp.id === masterComponent.id && comp.id !== canonicalComponent.id);
                
                if (!isDuplicateMaster) {
                  // This instance's master is not on the Icon Library page - keep the instance
                  console.log(`Keeping instance with external master: ${instanceIcon.name}`);
                  continue;
                }
                
                // This is a true duplicate - instance of a duplicate master component
                console.log(`Replacing duplicate instance: ${instanceIcon.name} (master: ${masterComponent.name} -> canonical: ${canonicalComponent.name})`);
                
                // Store instance properties
                const { x, y, rotation, opacity, visible } = instance;
                const parent = instance.parent;
                const index = parent && 'children' in parent ? parent.children.indexOf(instance) : 0;

                // Create new instance from canonical component
                const newInstance = canonicalComponentNode.createInstance();
                newInstance.x = x;
                newInstance.y = y;
                newInstance.rotation = rotation;
                newInstance.opacity = opacity;
                newInstance.visible = visible;

                // Insert at the same position
                if (parent && 'insertChild' in parent) {
                  parent.insertChild(index, newInstance);
                }

                // Remove old instance
                instance.remove();
                duplicatesRemoved++;
              }

            } catch (instanceError) {
              errors.push(`Failed to process instance ${instanceIcon.name}: ${instanceError instanceof Error ? instanceError.message : 'Unknown error'}`);
            }
          }

          // Delete duplicate frames (they're unresolved anyway)
          for (const frameIcon of frames) {
            try {
              const frameNode = await figma.getNodeByIdAsync(frameIcon.id);
              if (!frameNode || frameNode.type === 'PAGE') {
                errors.push(`Frame not found: ${frameIcon.name}`);
                continue;
              }

              // Simply remove the frame since it's an unresolved duplicate
              frameNode.remove();
              duplicatesRemoved++;
              console.log(`Removed duplicate frame: ${frameIcon.name}`);

            } catch (frameError) {
              errors.push(`Failed to remove frame ${frameIcon.name}: ${frameError instanceof Error ? frameError.message : 'Unknown error'}`);
            }
          }

        } else if (instances.length > 0) {
          // No master components, but we have instances
          // Keep the first instance, convert others to point to its master
          const keepInstance = instances[0];
          const removeInstances = instances.slice(1);

          try {
            const keepInstanceNode = await figma.getNodeByIdAsync(keepInstance.id);
            if (!keepInstanceNode || keepInstanceNode.type !== 'INSTANCE') {
              errors.push(`Instance to keep not found: ${keepInstance.name}`);
              continue;
            }

            const instance = keepInstanceNode as InstanceNode;
            const masterComponent = await instance.getMainComponentAsync();
            if (!masterComponent) {
              errors.push(`Instance has no master component: ${keepInstance.name}`);
              continue;
            }

            // Replace other instances to use the same master
            for (const removeInstance of removeInstances) {
              try {
                const removeNode = await figma.getNodeByIdAsync(removeInstance.id);
                if (!removeNode || removeNode.type !== 'INSTANCE') {
                  continue;
                }

                const oldInstance = removeNode as InstanceNode;
                const { x, y, rotation, opacity, visible } = oldInstance;
                const parent = oldInstance.parent;
                const index = parent && 'children' in parent ? parent.children.indexOf(oldInstance) : 0;

                // Create new instance from the master component
                const newInstance = masterComponent.createInstance();
                newInstance.x = x;
                newInstance.y = y;
                newInstance.rotation = rotation;
                newInstance.opacity = opacity;
                newInstance.visible = visible;

                if (parent && 'insertChild' in parent) {
                  parent.insertChild(index, newInstance);
                }

                oldInstance.remove();
                duplicatesRemoved++;

              } catch (replaceError) {
                errors.push(`Failed to replace instance ${removeInstance.name}: ${replaceError instanceof Error ? replaceError.message : 'Unknown error'}`);
              }
            }

            // Remove duplicate frames
            for (const frameIcon of frames) {
              try {
                const frameNode = await figma.getNodeByIdAsync(frameIcon.id);
                if (frameNode && frameNode.type !== 'PAGE') {
                  frameNode.remove();
                  duplicatesRemoved++;
                }
              } catch (frameError) {
                errors.push(`Failed to remove frame ${frameIcon.name}: ${frameError instanceof Error ? frameError.message : 'Unknown error'}`);
              }
            }

          } catch (instanceError) {
            errors.push(`Failed to process instance group: ${instanceError instanceof Error ? instanceError.message : 'Unknown error'}`);
          }

        } else if (frames.length > 1) {
          // Only frames, remove all but the first one
          const keepFrame = frames[0];
          const removeFrames = frames.slice(1);

          for (const frameIcon of removeFrames) {
            try {
              const frameNode = await figma.getNodeByIdAsync(frameIcon.id);
              if (frameNode && frameNode.type !== 'PAGE') {
                frameNode.remove();
                duplicatesRemoved++;
              }
            } catch (frameError) {
              errors.push(`Failed to remove frame ${frameIcon.name}: ${frameError instanceof Error ? frameError.message : 'Unknown error'}`);
            }
          }
        }

      } catch (groupError) {
        errors.push(`Failed to process group ${groupKey}: ${groupError instanceof Error ? groupError.message : 'Unknown error'}`);
      }
      
      processed++;
    }

    figma.ui.postMessage({
      type: 'library-consolidation-complete',
      data: { 
        duplicatesRemoved,
        errors: errors.length,
        errorDetails: errors,
        message: duplicatesRemoved > 0 
          ? `Successfully consolidated ${duplicatesRemoved} duplicate items using priority hierarchy (Components > Instances > Frames).`
          : 'No duplicates were found to consolidate.'
      }
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'library-consolidation-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
}

async function scanForIcons(): Promise<ScanResult> {
  const allIcons: IconInfo[] = [];
  const pages = figma.root.children;
  
  // Performance limits to prevent memory issues
  const MAX_ICONS = 1000;
  const MAX_PAGES = 50;
  
  // Check for excessively large files
  let pagesToProcess = pages;
  if (pages.length > MAX_PAGES) {
    console.log(`📄 Large file detected: ${pages.length} pages. Scanning first ${MAX_PAGES} pages for performance.`);
    figma.ui.postMessage({
      type: 'scan-progress',
      data: { 
        percentage: 5, 
        message: `Large file detected (${pages.length} pages). Scanning first ${MAX_PAGES} pages for performance...` 
      }
    });
    // Limit to first MAX_PAGES instead of throwing an error
    pagesToProcess = pages.slice(0, MAX_PAGES);
  }
  
  // Send initial progress
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 0 }
  });
  
  // Load all pages first (required by Figma API)
  try {
    console.log('📥 Loading all pages...');
    await figma.loadAllPagesAsync();
    console.log('✅ All pages loaded successfully');
  } catch (loadError) {
    console.error('❌ Failed to load pages:', loadError);
    figma.ui.postMessage({
      type: 'scan-error',
      data: { error: 'Failed to load pages: ' + (loadError instanceof Error ? loadError.message : 'Unknown error') }
    });
    return { totalIcons: 0, inconsistencies: 0, discoveredIcons: [] };
  }

  // Filter out archived pages - more flexible matching
  const pagesToScan = pagesToProcess.filter(page => {
    const pageName = page.name.toLowerCase();
    // Check for various archive page patterns
    const isArchivePage = pageName.includes('archive') || 
                         pageName.includes('🗄️') || 
                         pageName.includes('archived') ||
                         pageName.includes('old') ||
                         pageName.includes('backup');
    
    if (isArchivePage) {
      console.log(`⚠️ Skipping archive page: "${page.name}"`);
    }
    return !isArchivePage;
  });

  console.log(`📄 Pages to scan: ${pagesToScan.map(p => p.name).join(', ')}`);
  
  // Track all master components we find
  const masterComponentIds = new Set<string>();
  
  // 🔍 PHASE 1: Find ALL master components that match our icon criteria
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 10, message: 'Scanning for master icon components...' }
  });
  
  for (let pageIndex = 0; pageIndex < pagesToScan.length; pageIndex++) {
    const page = pagesToScan[pageIndex];
    
    try {
      figma.ui.postMessage({
        type: 'scan-progress',
        data: { 
          percentage: 10 + (pageIndex / pagesToScan.length) * 40,
          message: `Scanning components in: "${page.name}"`
        }
      });

      // Find all components and component sets on this page
      const allComponents = page.findAll(node => 
        node.type === 'COMPONENT' || node.type === 'COMPONENT_SET'
      ) as (ComponentNode | ComponentSetNode)[];
      
      console.log(`🔍 Found ${allComponents.length} components on page "${page.name}"`);
      
      for (const component of allComponents) {
        console.log(`🧩 Checking component: "${component.name}" (type: ${component.type})`);
        
        // Use our existing isLikelyIcon function to determine if this is an icon
        const isIcon = isLikelyIcon(component);
        console.log(`  - isLikelyIcon result: ${isIcon}`);
        
        if (isIcon) {
          const bounds = component.absoluteBoundingBox;
          if (!bounds) {
            console.log(`  - ❌ No bounds found for component: ${component.name}`);
            continue;
          }
          
          try {
            const preview = await generateIconPreview(component);
            const frameContext = determineFrameContext(component);
            
            // Track this master component
            masterComponentIds.add(component.id);
            
            const iconInfo: IconInfo = {
              id: component.id,
              name: component.name,
              type: component.type,
              width: Math.floor(bounds.width),
              height: Math.floor(bounds.height),
              page: page.name,
              frameContext: frameContext,
              source: parseIconSource(component.name),
              preview: preview,
              status: 'master',
              instanceCount: 0, // Will be calculated later
              hasInconsistency: false,
              inconsistencyReasons: [],
              componentSet: component.type === 'COMPONENT_SET' ? component.name : undefined,
              variants: component.type === 'COMPONENT_SET' && 'children' in component ? component.children.length : undefined,
              fills: component.type === 'COMPONENT' && 'fills' in component && Array.isArray(component.fills) ? component.fills : undefined,
              strokes: component.type === 'COMPONENT' && 'strokes' in component && Array.isArray(component.strokes) ? component.strokes : undefined
            };
            
            allIcons.push(iconInfo);
            console.log(`📦 Found master component: ${component.name} on page "${page.name}"`);
            
            // Handle component sets with variants - PERFORMANCE OPTIMIZED
            if (component.type === 'COMPONENT_SET' && 'children' in component && component.children.length > 0) {
              // Collect variant metadata only (no previews yet)
              const validVariants = [];
              let firstVariantPreview: string | undefined = undefined;
              
              for (const variant of component.children) {
                if (variant.type === 'COMPONENT') {
                  const variantBounds = variant.absoluteBoundingBox;
                  if (!variantBounds) continue;
                  
                  // Check if this variant falls under our icon size detection
                  const size = Math.max(variantBounds.width, variantBounds.height);
                  const aspectRatio = variantBounds.width / variantBounds.height;
                  
                  // Use icon size criteria: reasonable size and aspect ratio
                  const isIconSized = size >= 8 && size <= 200 && aspectRatio >= 0.5 && aspectRatio <= 2.0;
                  
                  if (isIconSized) {
                    // Store variant metadata without preview (for performance)
                    const variantData = {
                      id: variant.id,
                      name: variant.name,
                      width: Math.floor(variantBounds.width),
                      height: Math.floor(variantBounds.height),
                      preview: undefined as string | undefined, // Will be loaded on-demand
                      fills: 'fills' in variant && Array.isArray(variant.fills) ? variant.fills : undefined,
                      strokes: 'strokes' in variant && Array.isArray(variant.strokes) ? variant.strokes : undefined
                    };
                    
                    validVariants.push(variantData);
                    
                    // Track variant as master component too
                    masterComponentIds.add(variant.id);
                    
                    // Generate preview only for first variant (for component set preview)
                    if (firstVariantPreview === undefined) {
                      try {
                        firstVariantPreview = await generateIconPreview(variant);
                        variantData.preview = firstVariantPreview; // Store first variant preview
                      } catch (previewError) {
                        console.warn(`Failed to generate preview for first variant ${variant.name}:`, previewError);
                      }
                    }
                  }
                }
              }
              
              // If we have valid variants, update the component set info
              if (validVariants.length > 0) {
                // Update the main component set entry with first variant's preview and all variants info
                const componentSetIndex = allIcons.findIndex(icon => icon.id === component.id);
                if (componentSetIndex !== -1) {
                  allIcons[componentSetIndex].preview = firstVariantPreview;
                  allIcons[componentSetIndex].variants = validVariants.length;
                  allIcons[componentSetIndex].variantData = validVariants; // Store all variant data
                }
                
                console.log(`🎨 Found component set: ${component.name} with ${validVariants.length} variants (preview generated for first variant only)`);
              }
            }
            
            if (allIcons.length >= MAX_ICONS) break;
          } catch (componentError) {
            console.warn(`Failed to process component ${component.name}:`, componentError);
          }
        }
      }
      
      if (allIcons.length >= MAX_ICONS) break;
      
    } catch (pageError) {
      console.error(`Error scanning page ${page.name}:`, pageError);
    }
  }
  
  console.log(`📊 Found ${masterComponentIds.size} master icon components`);
  
  // 🔍 PHASE 2: Find instances of the master components
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { 
      percentage: 50,
      message: `Finding instances of ${masterComponentIds.size} master components...`
    }
  });
  
  for (let pageIndex = 0; pageIndex < pagesToScan.length; pageIndex++) {
    const page = pagesToScan[pageIndex];
    
    try {
      figma.ui.postMessage({
        type: 'scan-progress',
        data: { 
          percentage: 50 + (pageIndex / pagesToScan.length) * 25,
          message: `Scanning instances in: "${page.name}"`
        }
      });

      // Find all instances on this page
      const allInstances = page.findAll(node => node.type === 'INSTANCE') as InstanceNode[];
      
      for (const instance of allInstances) {
        try {
          const mainComponent = await instance.getMainComponentAsync();
          
          // Check if this instance references one of our discovered master components
          if (mainComponent && masterComponentIds.has(mainComponent.id)) {
            const bounds = instance.absoluteBoundingBox;
            if (bounds) {
              const preview = await generateIconPreview(instance);
              const frameContext = determineFrameContext(instance);
              
              const instanceIconInfo: IconInfo = {
                id: instance.id,
                name: instance.name,
                type: instance.type,
                width: Math.floor(bounds.width),
                height: Math.floor(bounds.height),
                page: page.name,
                frameContext: frameContext,
                source: parseIconSource(instance.name),
                preview: preview,
                status: 'instance',
                masterComponentId: mainComponent.id,
                hasInconsistency: false,
                inconsistencyReasons: [],
                componentSet: mainComponent.parent?.type === 'COMPONENT_SET' ? mainComponent.parent.name : undefined
              };
              
              allIcons.push(instanceIconInfo);
              console.log(`🔗 Found instance: ${instance.name} → ${mainComponent.name} on ${page.name}`);
              
              if (allIcons.length >= MAX_ICONS) break;
            }
          }
        } catch (instanceError) {
          // Skip instances that can't be processed
        }
      }
      
      if (allIcons.length >= MAX_ICONS) break;
      
    } catch (pageError) {
      console.error(`Error scanning page ${page.name} for instances:`, pageError);
    }
  }
  
  // 🔍 PHASE 3: Find unresolved icons (not organized in components)
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { 
      percentage: 75,
      message: 'Finding unresolved icons...'
    }
  });
  
  for (let pageIndex = 0; pageIndex < pagesToScan.length; pageIndex++) {
    const page = pagesToScan[pageIndex];
    
    try {
      figma.ui.postMessage({
        type: 'scan-progress',
        data: { 
          percentage: 75 + (pageIndex / pagesToScan.length) * 15,
          message: `Checking for unresolved icons in: "${page.name}"`
        }
      });

      // Only look for unresolved icons if we don't have too many already
      if (allIcons.length >= MAX_ICONS) break;
      
      // PERFORMANCE: Limit unresolved icons per page to prevent freezing
      const MAX_UNRESOLVED_PER_PAGE = 50;
      
      // Find all potential unresolved icon nodes
      const potentialIcons = page.findAll(node => 
        node.type === 'FRAME' ||
        node.type === 'GROUP' ||
        node.type === 'VECTOR' ||
        node.type === 'BOOLEAN_OPERATION'
      ) as any[];
      
      // Limit the number we process per page for performance
      const limitedPotentialIcons = potentialIcons.slice(0, MAX_UNRESOLVED_PER_PAGE * 3); // Search more, process less
      
      // Filter out nodes that are already part of our master-instance system
      const potentialUnresolvedIcons = limitedPotentialIcons.filter(node => {
        // Skip if this node is a child/content of a master component OR instance
        let parent = node.parent;
        while (parent && parent.type !== 'PAGE') {
          // Skip if inside a master component
          if (masterComponentIds.has(parent.id)) {
            return false;
          }
          
          // Skip if inside an instance of a master component
          if (parent.type === 'INSTANCE') {
            return false;
          }
          
          parent = parent.parent;
        }
        
        return true;
      });
      
      // Further limit to prevent performance issues
      const finalUnresolvedIcons = potentialUnresolvedIcons.slice(0, MAX_UNRESOLVED_PER_PAGE);
      
      if (potentialUnresolvedIcons.length > MAX_UNRESOLVED_PER_PAGE) {
        console.log(`⚡ Performance optimization: Found ${potentialUnresolvedIcons.length} potential icons on "${page.name}", limiting to ${MAX_UNRESOLVED_PER_PAGE} for performance`);
        figma.ui.postMessage({
          type: 'scan-progress',
          data: { 
            percentage: 75 + (pageIndex / pagesToScan.length) * 15,
            message: `"${page.name}": Processing ${MAX_UNRESOLVED_PER_PAGE} of ${potentialUnresolvedIcons.length} potential icons (optimized for performance)`
          }
        });
      }
      
      // Check each potential icon using our existing detection logic
      for (const node of finalUnresolvedIcons) {
        if (isLikelyIcon(node)) {
          const bounds = node.absoluteBoundingBox;
          if (!bounds) continue;
          
          try {
            const preview = await generateIconPreview(node);
            const frameContext = determineFrameContext(node);
            
            const iconInfo: IconInfo = {
              id: node.id,
              name: node.name,
              type: node.type,
              width: Math.floor(bounds.width),
              height: Math.floor(bounds.height),
              page: page.name,
              frameContext: frameContext,
              source: parseIconSource(node.name),
              preview: preview,
              status: 'unresolved',
              hasInconsistency: false,
              inconsistencyReasons: []
            };
            
            allIcons.push(iconInfo);
            console.log(`🔍 Found unresolved icon: ${node.name} on ${page.name}`);
            
            if (allIcons.length >= MAX_ICONS) break;
          } catch (unresolvedError) {
            console.warn(`Failed to process unresolved icon ${node.name}:`, unresolvedError);
          }
        }
      }
      
      if (allIcons.length >= MAX_ICONS) break;
      
    } catch (pageError) {
      console.error(`Error scanning page ${page.name} for unresolved icons:`, pageError);
    }
  }
  
  console.log(`📊 Total icons found: ${allIcons.length} (${allIcons.filter(i => i.status === 'master').length} masters, ${allIcons.filter(i => i.status === 'instance').length} instances, ${allIcons.filter(i => i.status === 'unresolved').length} unresolved)`);
  
  // Final processing
  figma.ui.postMessage({
    type: 'scan-progress',
    data: { percentage: 95, message: 'Finalizing results...' }
  });
  
  // Calculate icon instance counts
  const iconsWithInstanceCounts = calculateInstanceCounts(allIcons);
  
  // Analyze inconsistencies
  const iconsWithInconsistencies = analyzeIconConsistency(iconsWithInstanceCounts);
  
  // Apply user markings
  const iconsWithMarkings = await applyMarkingsToIcons(iconsWithInconsistencies);
  
  // Count inconsistencies
  const inconsistencyCount = iconsWithMarkings.filter(icon => icon.hasInconsistency).length;
  
  // Log final stats
  console.log(`📊 Final stats: ${iconsWithMarkings.length} total icons`, {
    masters: iconsWithMarkings.filter(i => i.status === 'master').length,
    instances: iconsWithMarkings.filter(i => i.status === 'instance').length,
    unresolved: iconsWithMarkings.filter(i => i.status === 'unresolved').length
  });
  
  // Show icons by page
  const pageBreakdown: {[page: string]: number} = {};
  iconsWithMarkings.forEach(icon => {
    pageBreakdown[icon.page] = (pageBreakdown[icon.page] || 0) + 1;
  });
  console.log('Icons by page:', pageBreakdown);
  
  return {
    totalIcons: iconsWithMarkings.length,
    inconsistencies: inconsistencyCount,
    discoveredIcons: iconsWithMarkings,
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
    await figma.setCurrentPageAsync(reviewPage);
    
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
      currentY += itemHeight + 20;
    }
    
    figma.ui.postMessage({
      type: 'review-page-created',
      data: { message: `Review page created with ${iconsToDisplay.length} icons${wasLimited ? ' (limited for performance)' : ''}.` }
    });
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'review-page-error',
      data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
    });
  }
}

async function generateSmartIconName(node: IconNode): Promise<string> {
  try {
    // Start with the original name
    let smartName = node.name;
    
    // Remove common prefixes/suffixes that don't add value
    smartName = smartName
      .replace(/^(icon|ico|symbol|glyph)[-_\s]*/i, '')
      .replace(/[-_\s]*(icon|ico|symbol|glyph)$/i, '')
      .replace(/^(vector|graphic|shape|element)[-_\s]*/i, '')
      .replace(/[-_\s]*(vector|graphic|shape|element)$/i, '');
    
    // Clean up the name
    smartName = smartName
      .replace(/[-_\s]+/g, ' ') // Replace multiple separators with single space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim(); // Remove leading/trailing whitespace
    
    // If the name is too short or generic, try to make it more descriptive
    if (smartName.length < 3 || ['icon', 'element', 'shape', 'graphic'].includes(smartName.toLowerCase())) {
      // Analyze the icon's visual characteristics
      const bounds = node.absoluteBoundingBox;
      if (bounds) {
        const aspectRatio = bounds.width / bounds.height;
        const size = Math.max(bounds.width, bounds.height);
        
        // Add size-based naming
        if (aspectRatio > 1.5) {
          smartName = 'Wide Icon';
        } else if (aspectRatio < 0.67) {
          smartName = 'Tall Icon';
        } else {
          smartName = 'Square Icon';
        }
        
        // Add size classification
        if (size <= 16) {
          smartName += ' Small';
        } else if (size >= 64) {
          smartName += ' Large';
        }
      }
    }
    
    // Convert to proper case (capitalize first letter of each word)
    smartName = smartName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    // Ensure it starts with a letter and contains only valid characters
    smartName = smartName.replace(/^[^a-zA-Z]+/, '').replace(/[^a-zA-Z0-9\s\-_]/g, '');
    
    // Fallback if name is still empty or invalid
    if (!smartName || smartName.length < 2) {
      const timestamp = Date.now().toString().slice(-4);
      smartName = `Icon ${timestamp}`;
    }
    
    return smartName;
    
  } catch (error) {
    // Fallback to a simple default name
    const timestamp = Date.now().toString().slice(-4);
    return `Icon ${timestamp}`;
  }
}

async function swapIcons(originalIcon: IconInfo, replacementIcon: IconInfo, sizingMode: string = 'scale-to-fit', needsConversion: boolean = false): Promise<void> {
  try {
    // Find the original icon node
    const originalNode = await figma.getNodeByIdAsync(originalIcon.id);
    if (!originalNode) {
      throw new Error('Original icon not found');
    }

    // Find or create the replacement component
    let replacementComponent: ComponentNode;
    
    if (needsConversion) {
      // Convert the replacement icon to a component first
      const replacementNode = await figma.getNodeByIdAsync(replacementIcon.id);
      if (!replacementNode) {
        throw new Error('Replacement icon not found');
      }

      // Create component from the replacement node
      if (replacementNode.type === 'COMPONENT') {
        replacementComponent = replacementNode;
      } else {
        // Clone the node and convert to component
        const clonedNode = (replacementNode as any).clone();
        
        // Create the component
        replacementComponent = figma.createComponent();
        replacementComponent.name = await generateSmartIconName(clonedNode as IconNode);
        replacementComponent.resize(clonedNode.width, clonedNode.height);
        replacementComponent.appendChild(clonedNode);
        
        // Move to Icon Library page
        let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library') as PageNode;
        if (!iconLibraryPage) {
          iconLibraryPage = figma.createPage();
          iconLibraryPage.name = '🎯 Icon Library';
        }
        iconLibraryPage.appendChild(replacementComponent);
      }
    } else {
      // Use existing component
      const replacementNode = await figma.getNodeByIdAsync(replacementIcon.id);
      if (!replacementNode || replacementNode.type !== 'COMPONENT') {
        throw new Error('Replacement is not a component');
      }
      replacementComponent = replacementNode;
    }

    // Create archive page for the original component if it doesn't exist
    let archivePage = figma.root.children.find(page => page.name === '🗄️ Archived Icons') as PageNode;
    if (!archivePage) {
      archivePage = figma.createPage();
      archivePage.name = '🗄️ Archived Icons';
    }

    let successCount = 0;
    const errors: string[] = [];
    const swapAffectedPages = new Set<string>();

    // If original is a component, find all its instances and replace them
    if (originalNode.type === 'COMPONENT') {
      const originalComponent = originalNode as ComponentNode;
      
      // Find all instances across all pages
      const allPages = figma.root.children;
      for (const page of allPages) {
        // First find all instances, then filter async
        const allInstances = page.findAll(node => node.type === 'INSTANCE') as InstanceNode[];
        
        // Filter instances that belong to this component
        const instances: InstanceNode[] = [];
        for (const instance of allInstances) {
          try {
            const mainComponent = await instance.getMainComponentAsync();
            if (mainComponent && mainComponent.id === originalComponent.id) {
              instances.push(instance);
            }
          } catch (error) {
            // Skip instances that can't be checked
            console.warn('Could not get main component for instance:', error);
          }
        }

        for (const instance of instances) {
          try {
            // Store instance properties
            const { x, y, rotation, opacity, visible } = instance;
            const parent = instance.parent;
            const index = parent && 'children' in parent ? parent.children.indexOf(instance) : 0;

            // Create new instance from replacement component
            const newInstance = replacementComponent.createInstance();
            
            // Apply sizing mode
            if (sizingMode === 'scale-to-fit') {
              // Scale the new instance to match original size
              const scaleX = originalIcon.width / replacementIcon.width;
              const scaleY = originalIcon.height / replacementIcon.height;
              newInstance.resize(originalIcon.width, originalIcon.height);
            } else {
              // Keep original size of replacement
              newInstance.resize(replacementIcon.width, replacementIcon.height);
            }

            // Apply stored properties
            newInstance.x = x;
            newInstance.y = y;
            newInstance.rotation = rotation;
            newInstance.opacity = opacity;
            newInstance.visible = visible;

            // Insert at the same position
            if (parent && 'insertChild' in parent) {
              parent.insertChild(index, newInstance);
            }

            // Remove old instance
            instance.remove();
            successCount++;
            swapAffectedPages.add(page.name);

          } catch (instanceError) {
            errors.push(`Failed to replace instance: ${instanceError instanceof Error ? instanceError.message : 'Unknown error'}`);
          }
        }
      }

      // Archive the original component
      const archivedComponent = originalComponent.clone();
      archivedComponent.name = `[Archived] ${originalComponent.name}`;
      archivePage.appendChild(archivedComponent);
      
      // Remove original component
      originalComponent.remove();
      successCount++; // Count the master component itself
      
    } else {
      // Handle non-component icons (just replace the single instance)
      try {
        const { x, y, rotation, opacity, visible } = originalNode as any;
        const parent = originalNode.parent;
        const index = parent && 'children' in parent ? parent.children.indexOf(originalNode as any) : 0;

        // Create instance from replacement component
        const newInstance = replacementComponent.createInstance();
        
        // Apply sizing mode
        if (sizingMode === 'scale-to-fit') {
          newInstance.resize(originalIcon.width, originalIcon.height);
        } else {
          newInstance.resize(replacementIcon.width, replacementIcon.height);
        }

        // Apply stored properties
        newInstance.x = x;
        newInstance.y = y;
        newInstance.rotation = rotation;
        newInstance.opacity = opacity;
        newInstance.visible = visible;

        // Insert at the same position
        if (parent && 'insertChild' in parent) {
          parent.insertChild(index, newInstance);
        }

        // Archive original if it's on a page
        if (parent && parent.type === 'PAGE') {
          const archivedNode = (originalNode as any).clone();
          archivedNode.name = `[Archived] ${originalNode.name}`;
          archivePage.appendChild(archivedNode);
        }

        // Remove original
        originalNode.remove();
        successCount++;
        
        if (parent && parent.type === 'PAGE') {
          swapAffectedPages.add((parent as PageNode).name);
        }

      } catch (nodeError) {
        errors.push(`Failed to replace icon: ${nodeError instanceof Error ? nodeError.message : 'Unknown error'}`);
      }
    }

    // Prepare success message
    let message = `Successfully swapped icons! `;
    if (needsConversion) {
      message += `Converted "${replacementIcon.name}" to component and `;
    }
    message += `replaced ${successCount} instance${successCount !== 1 ? 's' : ''}`;
    if (errors.length > 0) {
      message += ` with ${errors.length} error${errors.length !== 1 ? 's' : ''}`;
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

async function bulkExportIcons(icons: IconInfo[]): Promise<void> {
  try {
    console.log('Starting bulk export for', icons.length, 'icons');
    
    // Filter to only master components and component sets from any page
    const masterIcons = icons.filter(icon => 
      icon.status === 'master' || icon.type === 'COMPONENT' || icon.type === 'COMPONENT_SET'
    );
    
    if (masterIcons.length === 0) {
      throw new Error('No master icons found to export. Please ensure you have master components or component sets in your file.');
    }
    
    console.log('Filtered to', masterIcons.length, 'master icons for export');
    
    const exportedIcons: { name: string, svg: string, variants?: { name: string, svg: string }[], page?: string }[] = [];
    
    for (const icon of masterIcons) {
      try {
        const node = await figma.getNodeByIdAsync(icon.id);
        if (!node) {
          console.warn(`Icon node not found: ${icon.name}`);
          continue;
        }
        
        if (node.type === 'COMPONENT_SET') {
          // Handle component sets with variants
          const componentSet = node as ComponentSetNode;
          const variants: { name: string, svg: string }[] = [];
          
          // Export each variant
          for (const variant of componentSet.children) {
            if (variant.type === 'COMPONENT') {
              try {
                const variantSvg = await variant.exportAsync({ format: 'SVG' });
                const variantSvgString = String.fromCharCode.apply(null, Array.from(variantSvg));
                variants.push({
                  name: variant.name,
                  svg: variantSvgString
                });
                console.log(`Exported variant: ${variant.name}`);
              } catch (variantError) {
                console.error(`Failed to export variant ${variant.name}:`, variantError);
              }
            }
          }
          
          if (variants.length > 0) {
                      exportedIcons.push({
            name: componentSet.name,
            svg: '', // Component sets don't have their own SVG
            variants: variants,
            page: icon.page
          });
          }
          
        } else if (node.type === 'COMPONENT') {
          // Handle regular components
          const component = node as ComponentNode;
          try {
            const svgData = await component.exportAsync({ format: 'SVG' });
            const svgString = String.fromCharCode.apply(null, Array.from(svgData));
            
            exportedIcons.push({
              name: component.name,
              svg: svgString,
              page: icon.page
            });
            console.log(`Exported component: ${component.name}`);
          } catch (componentError) {
            console.error(`Failed to export component ${component.name}:`, componentError);
          }
        }
        
      } catch (nodeError) {
        console.error(`Error processing icon ${icon.name}:`, nodeError);
      }
    }
    
    if (exportedIcons.length === 0) {
      throw new Error('Failed to export any icons - all exports failed');
    }
    
    // Create the export data structure
    const exportData = {
      projectName: figma.root.name,
      exportDate: new Date().toISOString(),
      totalIcons: exportedIcons.length,
      totalVariants: exportedIcons.reduce((sum, icon) => sum + (icon.variants?.length || 0), 0),
      icons: exportedIcons,
      branding: 'Artificial Lack of Intelligence © 2025'
    };
    
    // For now, we'll log the export data and provide download instructions
    // Note: Figma plugins cannot directly write files to user's system for security reasons
    console.log('Export data prepared:', exportData);
    
    // Send success message with instructions
    figma.ui.postMessage({
      type: 'bulk-export-complete',
      data: {
        exportedCount: exportedIcons.length,
        exportPath: 'your downloads folder (see browser console for SVG data)',
        exportData: exportData // Include the actual data for browser download
      }
    });
    
  } catch (error) {
    console.error('Bulk export error:', error);
    figma.ui.postMessage({
      type: 'bulk-export-error',
      data: { 
        error: error instanceof Error ? error.message : 'Unknown export error occurred'
      }
    });
  }
}

async function convertSingleIconToComponent(icon: IconInfo): Promise<void> {
  try {
    console.log('Converting single icon to component:', icon.name);
    
    // Get the original node
    const originalNode = await figma.getNodeByIdAsync(icon.id);
    if (!originalNode || originalNode.type === 'PAGE') {
      throw new Error('Original icon not found or is invalid');
    }
    
    // Find or create the Icon Library page
    let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library') as PageNode;
    if (!iconLibraryPage) {
      iconLibraryPage = figma.createPage();
      iconLibraryPage.name = '🎯 Icon Library';
    }
    
    // Clone the node to the icon library page
    const clonedNode = (originalNode as any).clone();
    
    // Convert to component if it isn't already
    let component: ComponentNode;
    if (clonedNode.type === 'COMPONENT') {
      component = clonedNode;
      iconLibraryPage.appendChild(component);
    } else {
      // Create component from the cloned node
      component = figma.createComponent();
      component.name = await generateSmartIconName(clonedNode as IconNode);
      component.resize(clonedNode.width, clonedNode.height);
      
      // Position the cloned content at (0,0) relative to the component
      clonedNode.x = 0;
      clonedNode.y = 0;
      component.appendChild(clonedNode);
      
      iconLibraryPage.appendChild(component);
    }
    
    console.log(`Created master component: ${component.name}`);
    
    // Replace the original icon with an instance of the new component
    await replaceWithInstance(icon, component);
    
    console.log(`Replaced original icon with instance of ${component.name}`);
    
    // Send success message
    figma.ui.postMessage({
      type: 'single-icon-convert-complete',
      data: {
        iconName: component.name,
        componentId: component.id,
        message: `Successfully converted "${icon.name}" to master component "${component.name}"`
      }
    });
    
  } catch (error) {
    console.error('Error converting single icon:', error);
    throw error;
  }
}

async function replaceUnresolvedWithInstance(unresolvedIcon: IconInfo, masterComponentInfo: IconInfo): Promise<void> {
  try {
    console.log('Replacing unresolved icon with instance:', unresolvedIcon.name, '→', masterComponentInfo.name);
    
    // Get the unresolved icon node
    const unresolvedNode = await figma.getNodeByIdAsync(unresolvedIcon.id);
    if (!unresolvedNode || !('x' in unresolvedNode && 'y' in unresolvedNode && 'width' in unresolvedNode && 'height' in unresolvedNode)) {
      throw new Error('Unresolved icon not found or invalid');
    }
    
    // Get the master component node
    const masterComponentNode = await figma.getNodeByIdAsync(masterComponentInfo.id);
    if (!masterComponentNode || (masterComponentNode.type !== 'COMPONENT' && masterComponentNode.type !== 'COMPONENT_SET')) {
      throw new Error('Master component not found or invalid');
    }
    
    // Cast to appropriate types
    const unresolvedSceneNode = unresolvedNode as SceneNode;
    
    // Handle both individual components and component sets
    let masterComponent: ComponentNode;
    if (masterComponentNode.type === 'COMPONENT_SET') {
      // For component sets, use the default variant (first component)
      const componentSet = masterComponentNode as ComponentSetNode;
      const defaultVariant = componentSet.defaultVariant || componentSet.children[0] as ComponentNode;
      if (!defaultVariant || defaultVariant.type !== 'COMPONENT') {
        throw new Error('Component set has no valid variants');
      }
      masterComponent = defaultVariant;
    } else {
      masterComponent = masterComponentNode as ComponentNode;
    }
    
    // Create an instance of the master component
    const instance = masterComponent.createInstance();
    
    // Position the instance at the same location as the unresolved icon
    instance.x = unresolvedSceneNode.x;
    instance.y = unresolvedSceneNode.y;
    
    // Try to preserve the size if different
    if (Math.abs(unresolvedSceneNode.width - masterComponent.width) > 2 || 
        Math.abs(unresolvedSceneNode.height - masterComponent.height) > 2) {
      try {
        instance.resize(unresolvedSceneNode.width, unresolvedSceneNode.height);
      } catch (resizeError) {
        console.warn('Could not resize instance, using original size');
      }
    }
    
    // Insert the instance into the same parent as the unresolved icon
    if (unresolvedSceneNode.parent && unresolvedSceneNode.parent.type !== 'PAGE') {
      // Insert in the same position within the parent
      const parent = unresolvedSceneNode.parent as any;
      const unresolvedIndex = parent.children.indexOf(unresolvedSceneNode);
      parent.insertChild(unresolvedIndex, instance);
    } else {
      // Insert on the same page
      const page = unresolvedSceneNode.parent as PageNode;
      page.appendChild(instance);
    }
    
    // Remove the unresolved icon
    unresolvedSceneNode.remove();
    
    // Select the new instance
    figma.currentPage.selection = [instance];
    figma.viewport.scrollAndZoomIntoView([instance]);
    
    // Send success message
    figma.ui.postMessage({
      type: 'replace-with-instance-complete',
      data: {
        message: `Successfully replaced "${unresolvedIcon.name}" with instance of "${masterComponentInfo.name}"`
      }
    });
    
    console.log(`Successfully replaced ${unresolvedIcon.name} with instance of ${masterComponentInfo.name}`);
    
  } catch (error) {
    console.error('Error replacing unresolved icon with instance:', error);
    throw error;
  }
}

async function addSvgIconToLibrary(svgContent: string, fileName: string, width: number, height: number, expectedSize: { width: number, height: number }): Promise<void> {
  try {
    console.log('Adding SVG to library:', { fileName, width, height, expectedSize });
    console.log('SVG content length:', svgContent.length);
    
    // Find or create the Icon Library page
    let iconLibraryPage = figma.root.children.find(page => page.name === '🎯 Icon Library') as PageNode;
    
    if (!iconLibraryPage) {
      console.log('Creating new Icon Library page');
      iconLibraryPage = figma.createPage();
      iconLibraryPage.name = '🎯 Icon Library';
    }
    
    // Switch to the icon library page
    const originalPage = figma.currentPage;
    await figma.setCurrentPageAsync(iconLibraryPage);
    
    // Generate a clean component name from the file name
    const cleanFileName = fileName.replace(/\.svg$/, '').replace(/[^a-zA-Z0-9\-_]/g, '-');
    const componentName = `Icon/${cleanFileName}`;
    
    console.log('Component name:', componentName);
    
    // Check if component with this name already exists
    const existingComponent = iconLibraryPage.findChild(node => 
      node.type === 'COMPONENT' && node.name === componentName
    ) as ComponentNode;
    
    if (existingComponent) {
      console.log('Updating existing component:', existingComponent.name);
      try {
        // Clear existing content
        existingComponent.children.forEach(child => child.remove());
        
        // Create new SVG node from content
        console.log('Creating SVG node from content...');
        const svgNode = figma.createNodeFromSvg(svgContent);
        console.log('SVG node created:', { width: svgNode.width, height: svgNode.height });
        
        // Add SVG to the component
        existingComponent.appendChild(svgNode);
        
        // Resize component to match expected size or SVG size
        const targetWidth = expectedSize.width || width;
        const targetHeight = expectedSize.height || height;
        
        console.log('Resizing component to:', { targetWidth, targetHeight });
        existingComponent.resize(targetWidth, targetHeight);
        
        // Center the SVG content
        if (Math.abs(svgNode.width - targetWidth) > 1 || Math.abs(svgNode.height - targetHeight) > 1) {
          const scaleX = targetWidth / svgNode.width;
          const scaleY = targetHeight / svgNode.height;
          const scale = Math.min(scaleX, scaleY);
          
          console.log('Scaling SVG:', { scale, scaleX, scaleY });
          svgNode.resize(svgNode.width * scale, svgNode.height * scale);
          svgNode.x = (targetWidth - svgNode.width) / 2;
          svgNode.y = (targetHeight - svgNode.height) / 2;
        }
        
        figma.ui.postMessage({
          type: 'add-icon-complete',
          data: { message: `Updated existing icon "${componentName}" in Icon Library` }
        });
        
      } catch (error) {
        console.error('Error updating existing component:', error);
        throw new Error(`Failed to update existing component: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      console.log('Creating new component');
      try {
        // Create SVG node from content
        console.log('Creating SVG node from content...');
        const svgNode = figma.createNodeFromSvg(svgContent);
        console.log('SVG node created:', { width: svgNode.width, height: svgNode.height });
        
        // Create a component frame
        const component = figma.createComponent();
        component.name = componentName;
        
        // Set component size to expected size or SVG size
        const targetWidth = expectedSize.width || width;
        const targetHeight = expectedSize.height || height;
        
        console.log('Setting component size to:', { targetWidth, targetHeight });
        component.resize(targetWidth, targetHeight);
        
        // Add SVG to component
        component.appendChild(svgNode);
        
        // Center the SVG content if size doesn't match
        if (Math.abs(svgNode.width - targetWidth) > 1 || Math.abs(svgNode.height - targetHeight) > 1) {
          const scaleX = targetWidth / svgNode.width;
          const scaleY = targetHeight / svgNode.height;
          const scale = Math.min(scaleX, scaleY);
          
          console.log('Scaling SVG:', { scale, scaleX, scaleY });
          svgNode.resize(svgNode.width * scale, svgNode.height * scale);
          svgNode.x = (targetWidth - svgNode.width) / 2;
          svgNode.y = (targetHeight - svgNode.height) / 2;
        }
        
        // Position component in a grid layout
        const existingComponents = iconLibraryPage.children.filter(node => node.type === 'COMPONENT');
        const gridSize = 80; // Space between components
        const componentsPerRow = 10;
        
        const row = Math.floor(existingComponents.length / componentsPerRow);
        const col = existingComponents.length % componentsPerRow;
        
        component.x = col * gridSize;
        component.y = row * gridSize;
        
        console.log('Positioned component at:', { x: component.x, y: component.y });
        
        // Set component description
        component.description = `Icon imported from ${fileName}. Auto-organised by Icon Management plugin.`;
        
        figma.ui.postMessage({
          type: 'add-icon-complete',
          data: { message: `Added new icon "${componentName}" to Icon Library` }
        });
        
      } catch (error) {
        console.error('Error creating new component:', error);
        throw new Error(`Failed to create component from SVG: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    // Switch back to original page
    await figma.setCurrentPageAsync(originalPage);
    console.log('SVG icon added successfully');
    
  } catch (error) {
    console.error('Failed to add icon to library:', error);
    figma.ui.postMessage({
      type: 'add-icon-error',
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
      
    case 'generate-previews':
      try {
        const { iconIds } = msg;
        const previews: { [iconId: string]: string } = {};
        
        // Generate previews for requested icons
        for (const iconId of iconIds) {
          try {
            const node = await figma.getNodeByIdAsync(iconId);
            if (node && (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || 
                        node.type === 'FRAME' || node.type === 'INSTANCE' || 
                        node.type === 'GROUP' || node.type === 'VECTOR' || 
                        node.type === 'BOOLEAN_OPERATION')) {
              const preview = await generateIconPreview(node as IconNode);
              if (preview) {
                previews[iconId] = preview;
              }
            }
          } catch (error) {
            // Skip this icon if we can't generate preview
          }
        }
        
        figma.ui.postMessage({
          type: 'previews-generated',
          data: { previews }
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'previews-error',
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
              await figma.setCurrentPageAsync(pageNode as PageNode);
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
      
    case 'mark-icon':
      try {
        await markIcon(msg.iconId, msg.markType);
        figma.ui.postMessage({
          type: 'icon-marked',
          data: { 
            iconId: msg.iconId, 
            markType: msg.markType,
            message: getMarkingMessage(msg.markType)
          }
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'icon-mark-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'clear-all-markings':
      try {
        await clearAllMarkings();
        figma.ui.postMessage({
          type: 'markings-cleared',
          data: { message: 'All icon markings cleared' }
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'markings-clear-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'add-icon-to-library':
      try {
        await addSvgIconToLibrary(msg.svgContent, msg.fileName, msg.width, msg.height, msg.expectedSize);
      } catch (error) {
        figma.ui.postMessage({
          type: 'add-icon-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'bulk-export-icons':
      try {
        await bulkExportIcons(msg.icons);
      } catch (error) {
        figma.ui.postMessage({
          type: 'bulk-export-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'convert-single-icon':
      try {
        // Find the icon in the current scene
        const iconNode = await figma.getNodeByIdAsync(msg.iconId);
        if (!iconNode) {
          throw new Error('Icon not found');
        }
        
        // Create a minimal IconInfo object for the conversion
        const iconInfo: IconInfo = {
          id: msg.iconId,
          name: msg.iconName || iconNode.name || 'Unnamed Icon',
          type: iconNode.type,
          width: 'width' in iconNode ? iconNode.width : 24,
          height: 'height' in iconNode ? iconNode.height : 24,
          page: figma.currentPage.name,
          source: parseIconSource(iconNode.name || 'Unnamed Icon'),
          status: 'unresolved',
          hasInconsistency: false,
          inconsistencyReasons: []
        };
        
        await convertSingleIconToComponent(iconInfo);
      } catch (error) {
        figma.ui.postMessage({
          type: 'single-icon-convert-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'generate-variant-preview':
      try {
        const variantNode = await figma.getNodeByIdAsync(msg.variantId);
        if (variantNode) {
          const preview = await generateIconPreview(variantNode as IconNode);
          figma.ui.postMessage({
            type: 'variant-preview-generated',
            data: {
              variantId: msg.variantId,
              preview: preview
            }
          });
        } else {
          figma.ui.postMessage({
            type: 'variant-preview-error',
            data: { error: 'Variant not found' }
          });
        }
      } catch (error) {
        figma.ui.postMessage({
          type: 'variant-preview-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error' }
        });
      }
      break;
      
    case 'replace-with-instance':
      try {
        await replaceUnresolvedWithInstance(msg.unresolvedIcon, msg.masterComponent);
      } catch (error) {
        figma.ui.postMessage({
          type: 'replace-with-instance-error',
          data: { error: error instanceof Error ? error.message : 'Unknown error occurred' }
        });
      }
      break;
      
    case 'select-icon':
      try {
        const iconNode = await figma.getNodeByIdAsync(msg.iconId);
        if (iconNode && 'id' in iconNode) {
          figma.currentPage.selection = [iconNode as SceneNode];
          figma.viewport.scrollAndZoomIntoView([iconNode as SceneNode]);
        }
      } catch (error) {
        console.error('Error selecting icon:', error);
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