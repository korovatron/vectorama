import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const APP_VERSION = '1.0.0';

// Title Screen Functionality
const titleScreen = document.getElementById('title-screen');
const mainApp = document.getElementById('main-app');
const startBtn = document.getElementById('start-btn');
const appVersionLabel = document.getElementById('app-version-label');
let startAppInitTimeoutId = null;

if (appVersionLabel) {
    appVersionLabel.textContent = APP_VERSION;
}

let appInitialized = false;

function startApp() {
    titleScreen.classList.add('hidden');
    mainApp.style.display = 'block';

    // Initialize the app only after the container is visible
    if (!appInitialized) {
        if (startAppInitTimeoutId !== null) {
            clearTimeout(startAppInitTimeoutId);
        }

        startAppInitTimeoutId = setTimeout(() => {
            startAppInitTimeoutId = null;

            if (appInitialized || mainApp.style.display === 'none') {
                return;
            }

            const app = new VectoramaApp();
            window.vectoramaApp = app;
            appInitialized = true;
        }, 0);
    }
}

function returnToTitleScreen() {
    if (startAppInitTimeoutId !== null) {
        clearTimeout(startAppInitTimeoutId);
        startAppInitTimeoutId = null;
    }

    titleScreen.classList.remove('hidden');
    mainApp.style.display = 'none';
    appInitialized = false;

    if (window.vectoramaApp && window.vectoramaApp.cleanup) {
        window.vectoramaApp.cleanup();
    }
    window.vectoramaApp = null;
}

startBtn.addEventListener('click', () => {
    startApp();
});

// Allow space bar to start the app from title screen
// Allow ESC to return to title screen
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !appInitialized) {
        e.preventDefault(); // Prevent page scroll
        startApp();
    } else if (e.code === 'Escape' && appInitialized) {
        const shortcutsOverlay = document.getElementById('shortcuts-overlay');
        if (shortcutsOverlay && shortcutsOverlay.classList.contains('show') && window.vectoramaApp && window.vectoramaApp.toggleShortcutsOverlay) {
            window.vectoramaApp.toggleShortcutsOverlay();
            return;
        }

        returnToTitleScreen();
    }
});

// iOS viewport height fix - necessary for full-screen rendering into notch and chrome areas
// Sets a CSS variable for the actual viewport height, which works around iOS Safari's 100vh issue
function setActualVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--actual-vh', `${vh}px`);
}

// Set on load
setActualVH();

// Update on resize and orientation change
window.addEventListener('resize', setActualVH);
window.addEventListener('orientationchange', () => {
    // Small delay needed for iOS to complete the orientation change
    setTimeout(setActualVH, 100);
});

// Theme Toggle Functionality
const themeToggle = document.getElementById('theme-toggle');
const lightIcon = document.getElementById('light-icon');
const darkIcon = document.getElementById('dark-icon');
const APP_STATE_STORAGE_KEY = 'vectorama-app-state-v1';

// Load theme from localStorage or default to dark
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    lightIcon.classList.add('theme-active');
    darkIcon.classList.remove('theme-active');
} else {
    lightIcon.classList.remove('theme-active');
    darkIcon.classList.add('theme-active');
}

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Toggle active class
    if (newTheme === 'light') {
        lightIcon.classList.add('theme-active');
        darkIcon.classList.remove('theme-active');
    } else {
        lightIcon.classList.remove('theme-active');
        darkIcon.classList.add('theme-active');
    }
    
    // Update scene background if app exists
    if (window.vectoramaApp) {
        window.vectoramaApp.updateTheme();
        window.vectoramaApp.scheduleStateSave();
    }
});

class VectoramaApp {
    constructor() {
        this.dimension = '2d'; // '2d' or '3d'
        
        // Separate storage for 2D and 3D modes
        this.vectors2D = [];
        this.vectors3D = [];
        this.matrices2D = [];
        this.matrices3D = [];
        this.lines2D = [];
        this.lines3D = [];
        this.planes3D = []; // Planes only in 3D
        this.usedMatrixLetters2D = new Set();
        this.usedMatrixLetters3D = new Set();
        this.selectedMatrixId2D = null;
        this.selectedMatrixId3D = null;
        this.colorIndex2D = 0;
        this.colorIndex3D = 0;
        
        // Active references (point to current dimension)
        this.vectors = this.vectors2D;
        this.matrices = this.matrices2D;
        this.lines = this.lines2D;
        this.planes = this.planes3D; // Will always reference 3D planes
        this.usedMatrixLetters = this.usedMatrixLetters2D;
        this.selectedMatrixId = this.selectedMatrixId2D;
        this.colorIndex = this.colorIndex2D;
        this.eigenvaluePanelMatrixId = null; // Track which matrix's info is showing in eigenvalue panel
        this.lineInfoPanelId = null; // Track which line's info is showing
        this.planeInfoPanelId = null; // Track which plane's info is showing
        this.vectorInfoPanelId = null; // Track which vector's info is showing
        
        this.isAnimating = false;
        this.animationSpeed = 2.0;
        this.isDragging = false;
        this.axisLengthX = 100; // Dynamic X axis length
        this.axisLengthY = 100; // Dynamic Y axis length
        this.axisLengthZ = 100; // Dynamic Z axis length
        this.lastCameraDistance = 0; // Track camera distance for vector thickness updates
        this.tempArrow = null;
        this.gridVisible = true; // Grid visibility state
        this.intersectionsVisible = true; // Intersection markers/lines visibility state
        this.planeExtent = 10; // Plane half-size in each direction
        this.currentGridSpacing = 1; // Current grid spacing
        this.last2DLabelBounds = null; // Track last generated 2D label coverage
        this.isResizing = false; // Flag to prevent animation loop interference
        this.resizeTimeout = null; // For debouncing
        this.updateTimeout = null; // For debouncing grid/axes updates during zoom
        this.lastUpdateTime = 0; // Track last update time for throttling
        this.viewResetAnimation = null; // Active camera reset animation state
        
        // Vector color palette matching graphiti
        this.vectorColors = [
            '#4A90E2', '#27AE60', '#F39C12', 
            '#E91E63', '#1ABC9C', '#E67E22', '#34495E',
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#E74C3C'
        ];
        this.colorIndex = 0; // Track next color to use
        
        this.invariantLines = []; // Store invariant line objects (eigenvectors)
        this.invariantPlanes = []; // Store invariant plane objects (eigenspaces)
        this.rainbowTime = 0; // Time variable for rainbow pulsing effect
        this.invariantDisplayMode = 'off'; // 'off', 'solid', 'pulse'
        this.vectorDisplayMode = 'points'; // 'vectors' or 'points'
        this.vectorSizeMode = 'small'; // 'small' or 'large'
        this.presetEdges2D = []; // Hidden edge pairs for 2D preset groups
        this.presetEdges3D = []; // Hidden edge pairs for 3D preset groups
        this.presetEdgeMeshes2D = []; // Rendered edge meshes for 2D presets
        this.presetEdgeMeshes3D = []; // Rendered edge meshes for 3D presets
        this.presetFaces2D = []; // Hidden face triples for 2D preset groups (unused)
        this.presetFaces3D = []; // Hidden face triples for 3D preset groups
        this.presetFaceMeshes2D = []; // Rendered face meshes for 2D presets (unused)
        this.presetFaceMeshes3D = []; // Rendered face meshes for 3D presets
        this.presetEdges = this.presetEdges2D;
        this.presetEdgeMeshes = this.presetEdgeMeshes2D;
        this.presetFaces = this.presetFaces2D;
        this.presetFaceMeshes = this.presetFaceMeshes2D;
        
        // Interaction/performance state
        this.isInteracting = false; // Track when user is actively panning/rotating/zooming
        this.intersectionMarkers = []; // Store line-plane intersection markers
        this.planeIntersectionLines = []; // Store plane-plane intersection lines
        this.angleVisualization = null; // Store temporary angle visualization overlay
        this.angleVisualizationState = null; // Track currently selected angle comparison
        this.angleRainbowSpeed = 0.18; // Hue cycles per second for angle overlay
        this.intersectionRainbowPhase = 0.37; // Fixed phase offset so intersections are out of sync with angles
        
        // Collapsible group state (all collapsed by default)
        this.groupCollapsed = {
            matrices: true,
            planes: true,
            lines: true,
            vectors: true
        };

        this.cameraState2D = null;
        this.cameraState3D = null;
        this.stateSaveTimeout = null;
        
        // Unique ID counters
        this.nextVectorId = 1;
        this.nextMatrixId = 1;
        this.nextLineId = 1;
        this.nextPlaneId = 1;
        
        // Google Analytics tracking
        this.lastAnalyticsEvent = 0;
        this.lastPanelEvent = 0;
        this.analyticsThrottleMs = 30000; // Send event max once per 30 seconds
        this.isDestroyed = false;
        this.animationFrameId = null;
        this.eventAbortController = new AbortController();
        
        this.panelOpen = true; // Panel open by default
        this.initThreeJS();
        this.initEventListeners();
        this.createGrid();
        this.createAxes();
        this.animate();

        const restoredFromState = this.restoreAppState();
        if (!restoredFromState) {
            // Initialize with default content
            this.initializeDefaultContent();
            this.captureCurrentCameraState();
        }
        
        // Visualize invariant spaces for initial identity matrix after scene is ready
        requestAnimationFrame(() => {
            this.visualizeInvariantSpaces();
        });
    }

    initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        
        // Set initial background based on theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.scene.background = new THREE.Color(currentTheme === 'light' ? 0xFDFDFD : 0x606060);

        // Camera
        this.canvas = document.getElementById('three-canvas');
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspect, 0.01, 500); // Reduced near plane to prevent clipping when zoomed close
        this.camera.position.set(0, 0, 5); // Start zoomed in for 2D mode
        this.camera.lookAt(0, 0, 0);

        // Detect device type before creating renderer
        const userAgent = navigator.userAgent || '';
        const isIPhoneOrIPod = /iPhone|iPod/.test(userAgent);
        const isAndroid = /Android/.test(userAgent);
        const isiPadOSDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIPad = /iPad/.test(userAgent) || isiPadOSDesktopUA;
        const isAndroidTablet = isAndroid && !/Mobile/.test(userAgent);
        const isTablet = isIPad || /tablet/i.test(userAgent) || isAndroidTablet;
        const isMobilePhone = (isIPhoneOrIPod || (isAndroid && /Mobile/.test(userAgent))) && !isTablet;
        
        // Renderer - keep antialiasing and depth buffer for stability
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas,
            antialias: true,
            logarithmicDepthBuffer: true,
            powerPreference: 'high-performance' // Request high-performance GPU
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        
        // Clamp pixel ratio on mobile phones to prevent GPU overload
        // Tablets (like iPad Pro) can handle higher pixel ratios, so only limit phones
        const pixelRatio = isMobilePhone 
            ? Math.min(window.devicePixelRatio, 2.0)
            : window.devicePixelRatio;
        this.renderer.setPixelRatio(pixelRatio);
        
        // Store device info for debug panel
        this.deviceInfo = {
            isMobilePhone: isMobilePhone,
            isTablet: isTablet,
            isIPad: isIPad,
            devicePixelRatio: window.devicePixelRatio,
            clampedPixelRatio: pixelRatio,
            deviceType: isMobilePhone ? 'Mobile Phone' : (isTablet ? 'Tablet' : 'Desktop')
        };

        // Controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;
        this.controls.enableRotate = false; // Start in 2D mode with rotation disabled
        
        // Set zoom limits - prevent extreme zoom on mobile phones to reduce GPU stress
        this.controls.minDistance = isMobilePhone ? 2 : 1;   // Mobile phones can't zoom as close
        this.controls.maxDistance = 100; // Prevent zooming beyond axis endpoints
        
        // Set mouse button mappings for 2D mode (left click = pan, right for vectors)
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY
        };
        
        // Set touch mappings for 2D mode (one finger = pan, pinch = zoom)
        this.controls.touches = {
            ONE: THREE.TOUCH.PAN,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
        
        // Track graph interactions (pan/zoom) for analytics
        this.controls.addEventListener('change', () => this.trackEngagement());
        
        // Track interaction start/end for performance optimization
        this.controls.addEventListener('start', () => {
            this.isInteracting = true;
        });
        
        this.controls.addEventListener('end', () => {
            this.isInteracting = false;
            this.captureCurrentCameraState();
            this.scheduleStateSave();
        });

        // Raycaster for clicking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Handle canvas resize using ResizeObserver
        this.onWindowResize = this.onWindowResize.bind(this);
        this.resizeObserver = new ResizeObserver(() => {
            this.onWindowResize();
        });
        this.resizeObserver.observe(this.canvas);
        
        // Also add window resize listener
        this.windowResizeHandler = () => {
            this.onWindowResize();
        };
        window.addEventListener('resize', this.windowResizeHandler, {
            signal: this.eventAbortController.signal
        });
    }

    createGrid(spacing = null) {
        // Calculate optimal spacing based on camera distance if not provided
        if (spacing === null) {
            spacing = this.calculateGridSpacing();
        }
        this.currentGridSpacing = spacing;
        
        // Remove old grid if exists
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
        }
        
        // Remove old axis numbers if exist
        if (this.axisNumbers) {
            this.scene.remove(this.axisNumbers);
        }
        this.axisNumbers = new THREE.Group();

        if (this.dimension === '2d') {
            // 2D: Create flat grid on XY plane with adaptive spacing
            // Calculate grid size based on visible viewport dimensions
            const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
            const fov = this.camera.fov * Math.PI / 180;
            const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
            const visibleHeight = 2 * distanceToTarget * Math.tan(fov / 2);
            const visibleWidth = visibleHeight * aspect;
            const desiredSize = Math.max(visibleWidth, visibleHeight) * 50; // Large grid for extensive panning
            
            // Ensure divisions is even so origin is at grid intersection, not cell center
            let divisions = Math.floor(desiredSize / spacing);
            if (divisions % 2 !== 0) divisions++; // Make it even
            
            // Recalculate size to be exact multiple of spacing
            const size = divisions * spacing;
            
            // Match 3D grid color and transparency
            this.gridHelper = new THREE.GridHelper(size, divisions, 0x888888, 0x888888);
            this.gridHelper.rotation.x = Math.PI / 2;
            this.gridHelper.position.z = 0;
            this.gridHelper.visible = this.gridVisible;
            
            // Make 2D grid a true background layer to avoid parallax/z-fighting against axes and vectors
            const gridMaterials = Array.isArray(this.gridHelper.material)
                ? this.gridHelper.material
                : [this.gridHelper.material];
            gridMaterials.forEach(material => {
                material.transparent = true;
                material.opacity = 0.5;
                material.depthWrite = false;
                material.depthTest = false;
            });
            this.gridHelper.renderOrder = -100;
            
            this.scene.add(this.gridHelper);
            
            // Add axis numbers for 2D mode
            // Clamp to visible viewport and axis limits (-100 to +100)
            const labelOffset = distanceToTarget * 0.03; // Fixed screen-space offset
            const halfVisibleWidth = visibleWidth / 2;
            const halfVisibleHeight = visibleHeight / 2;
            const minX = Math.max(-100, this.controls.target.x - halfVisibleWidth);
            const maxX = Math.min(100, this.controls.target.x + halfVisibleWidth);
            const minY = Math.max(-100, this.controls.target.y - halfVisibleHeight);
            const maxY = Math.min(100, this.controls.target.y + halfVisibleHeight);

            this.last2DLabelBounds = { minX, maxX, minY, maxY };

            const xStart = Math.ceil(minX / spacing);
            const xEnd = Math.floor(maxX / spacing);
            const yStart = Math.ceil(minY / spacing);
            const yEnd = Math.floor(maxY / spacing);

            const maxLabelsPerAxis = 30;
            const xCount = Math.max(0, xEnd - xStart + 1);
            const yCount = Math.max(0, yEnd - yStart + 1);
            const xStride = Math.max(1, Math.ceil(xCount / maxLabelsPerAxis));
            const yStride = Math.max(1, Math.ceil(yCount / maxLabelsPerAxis));
            
            // Get theme-appropriate colors for axis labels
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isLight = currentTheme === 'light';
            const xColor = isLight ? '#cc0000' : '#ff0000'; // Pure red in dark mode (with outline for readability)
            const yColor = isLight ? '#009900' : '#00ff00'; // Pure green in dark mode
            
            for (let xi = xStart; xi <= xEnd; xi++) {
                if (xi === 0) continue; // Skip origin
                if ((xi - xStart) % xStride !== 0) continue;
                const value = xi * spacing;

                // X axis numbers (below the axis) - red for x-axis
                const xLabel = this.createNumberLabel(value, xColor);
                xLabel.position.set(value, -labelOffset, 0);
                xLabel.userData = { axis: 'x', value: value };
                this.axisNumbers.add(xLabel);
            }

            for (let yi = yStart; yi <= yEnd; yi++) {
                if (yi === 0) continue; // Skip origin
                if ((yi - yStart) % yStride !== 0) continue;
                const value = yi * spacing;

                // Y axis numbers (left of the axis) - green for y-axis
                const yLabel = this.createNumberLabel(value, yColor);
                yLabel.position.set(-labelOffset, value, 0);
                yLabel.userData = { axis: 'y', value: value };
                this.axisNumbers.add(yLabel);
            }
            
            this.axisNumbers.visible = this.gridVisible;
            this.scene.add(this.axisNumbers);
        } else {
            this.last2DLabelBounds = null;
            // 3D: Create grid plane at y=0 (XZ plane - ground)
            this.gridHelper = new THREE.Group();
            const gridSize = 30; // Grid extent
            const halfGridSize = gridSize / 2;
            const halfSize = (gridSize * spacing) / 2;
            
            const lineMaterial = new THREE.LineBasicMaterial({ 
                color: 0x888888,
                transparent: true,
                opacity: 0.5,
                depthWrite: false
            });
            
            // XZ plane (y=0) - lines parallel to X and Z
            for (let xi = -halfGridSize; xi <= halfGridSize; xi++) {
                const x = xi * spacing;
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(x, 0, -halfSize),
                    new THREE.Vector3(x, 0, halfSize)
                ]);
                const line = new THREE.Line(geometry, lineMaterial.clone());
                this.gridHelper.add(line);
            }
            for (let zi = -halfGridSize; zi <= halfGridSize; zi++) {
                const z = zi * spacing;
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-halfSize, 0, z),
                    new THREE.Vector3(halfSize, 0, z)
                ]);
                const line = new THREE.Line(geometry, lineMaterial.clone());
                this.gridHelper.add(line);
            }
            
            this.gridHelper.visible = this.gridVisible;
            this.scene.add(this.gridHelper);
            
            // Add axis numbers for 3D mode
            // Keep labels aligned to visible 3D grid extent for performance
            const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
            const labelOffset = distanceToTarget * 0.03; // Fixed screen-space offset
            const maxRange = Math.floor(100 / spacing);
            const range = Math.min(maxRange, halfGridSize);
            
            // Get theme-appropriate colors for axis labels
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isLight = currentTheme === 'light';
            const xColor = isLight ? '#cc0000' : '#ff0000'; // Pure red in dark mode (with outline for readability)
            const yColor = isLight ? '#009900' : '#00ff00'; // Pure green in dark mode
            const zColor = isLight ? '#0000cc' : '#0000ff'; // Pure blue in dark mode
            
            for (let i = -range; i <= range; i++) {
                if (i === 0) continue; // Skip origin
                const value = i * spacing;
                
                // X axis numbers (along x axis, on XZ plane) - red for x-axis
                const xLabel = this.createNumberLabel(value, xColor);
                xLabel.position.set(value, 0, -labelOffset);
                xLabel.userData = { axis: 'x', value: value };
                this.axisNumbers.add(xLabel);
                
                // Y axis numbers (along y axis, on YZ plane) - green for y-axis
                const yLabel = this.createNumberLabel(value, yColor);
                yLabel.position.set(-labelOffset, value, 0);
                yLabel.userData = { axis: 'y', value: value };
                this.axisNumbers.add(yLabel);
                
                // Z axis numbers (along z axis, on XZ plane) - blue for z-axis
                const zLabel = this.createNumberLabel(value, zColor);
                zLabel.position.set(0, -labelOffset, value);
                zLabel.userData = { axis: 'z', value: value };
                this.axisNumbers.add(zLabel);
            }
            
            this.axisNumbers.visible = this.gridVisible;
            this.scene.add(this.axisNumbers);
        }
    }

    calculateGridSpacing() {
        // Calculate optimal grid spacing based on camera distance to target (zoom level)
        const distance = this.camera.position.distanceTo(this.controls.target);
        
        // Define spacing thresholds - nice round numbers
        const spacings = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
        
        // Target: approximately 10-20 grid lines visible across viewport height
        const fov = this.camera.fov * Math.PI / 180;
        const visibleHeight = 2 * distance * Math.tan(fov / 2);
        const targetSpacing = visibleHeight / 15; // Aim for ~15 divisions
        
        // Find closest spacing value
        let bestSpacing = spacings[0];
        let minDiff = Math.abs(Math.log(targetSpacing) - Math.log(spacings[0]));
        
        for (const s of spacings) {
            const diff = Math.abs(Math.log(targetSpacing) - Math.log(s));
            if (diff < minDiff) {
                minDiff = diff;
                bestSpacing = s;
            }
        }
        
        return bestSpacing;
    }

    updateGridSpacing() {
        // Throttle updates to prevent constant recreation during zoom
        const now = Date.now();
        if (now - this.lastUpdateTime < 150) return; // Only update every 150ms max
        
        // Only update if spacing changes significantly
        const optimalSpacing = this.calculateGridSpacing();
        
        if (optimalSpacing !== this.currentGridSpacing) {
            this.lastUpdateTime = now;
            this.createGrid(optimalSpacing);
            return;
        }

        // In 2D, also refresh labels when viewport extends beyond currently labeled bounds
        // even if spacing itself has not changed.
        if (this.dimension === '2d' && this.last2DLabelBounds && this.currentGridSpacing > 0) {
            const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
            const fov = this.camera.fov * Math.PI / 180;
            const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
            const visibleHeight = 2 * distanceToTarget * Math.tan(fov / 2);
            const visibleWidth = visibleHeight * aspect;
            const halfVisibleWidth = visibleWidth / 2;
            const halfVisibleHeight = visibleHeight / 2;

            const minX = Math.max(-100, this.controls.target.x - halfVisibleWidth);
            const maxX = Math.min(100, this.controls.target.x + halfVisibleWidth);
            const minY = Math.max(-100, this.controls.target.y - halfVisibleHeight);
            const maxY = Math.min(100, this.controls.target.y + halfVisibleHeight);

            const margin = this.currentGridSpacing;
            const bounds = this.last2DLabelBounds;
            const needsRefresh =
                minX < bounds.minX - margin ||
                maxX > bounds.maxX + margin ||
                minY < bounds.minY - margin ||
                maxY > bounds.maxY + margin;

            if (needsRefresh) {
                this.lastUpdateTime = now;
                this.createGrid(this.currentGridSpacing);
            }
        }
    }

    createAxes() {
        // Remove old axes if exists
        if (this.axesGroup) {
            this.scene.remove(this.axesGroup);
        }

        this.axesGroup = new THREE.Group();

        if (this.dimension === '2d') {
            // 2D mode: Black axes with arrow heads and labels
            this.create2DAxes();
        } else {
            // 3D mode: Color-coded axes extending far (RGB = XYZ)
            this.create3DAxes();
        }
        
        this.scene.add(this.axesGroup);
    }

    create2DAxes() {
        // 2D mode: Gray axes matching grid color
        // Extend far in both directions for visibility during panning
        const axisLength = 100; // Very long axes
        const thickness = this.getArrowThickness();
        const lineWidth = thickness.headWidth * 0.15;

        // X axis - Gray
        const xAxisPos = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(axisLength, 0, 0),
            0x888888,
            lineWidth
        );
        const xAxisNeg = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-axisLength, 0, 0),
            0x888888,
            lineWidth
        );

        // Y axis - Gray
        const yAxisPos = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, axisLength, 0),
            0x888888,
            lineWidth
        );
        const yAxisNeg = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -axisLength, 0),
            0x888888,
            lineWidth
        );

        this.axesGroup.add(xAxisPos, xAxisNeg, yAxisPos, yAxisNeg);
    }

    create3DAxes() {
        // 3D mode: Gray axes matching grid color
        // Extend far in both directions for visibility during rotation
        const axisLength = 100; // Very long axes
        const thickness = this.getArrowThickness();
        const lineWidth = thickness.headWidth * 0.15;

        // X axis - Gray
        const xAxisPos = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(axisLength, 0, 0),
            0x888888,
            lineWidth
        );
        const xAxisNeg = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(-axisLength, 0, 0),
            0x888888,
            lineWidth
        );

        // Y axis - Gray
        const yAxisPos = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, axisLength, 0),
            0x888888,
            lineWidth
        );
        const yAxisNeg = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, -axisLength, 0),
            0x888888,
            lineWidth
        );

        // Z axis - Gray
        const zAxisPos = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, axisLength),
            0x888888,
            lineWidth
        );
        const zAxisNeg = this.createAxisLine(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -axisLength),
            0x888888,
            lineWidth
        );

        this.axesGroup.add(xAxisPos, xAxisNeg, yAxisPos, yAxisNeg, zAxisPos, zAxisNeg);
    }

    createAxisLabel(text, color) {
        // Create a canvas to render text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 128;
        
        // Set font and draw text
        context.font = 'Bold 80px Arial';
        context.fillStyle = '#' + color.toString(16).padStart(6, '0');
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 64, 64);
        
        // Create sprite from canvas
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);
        
        // Scale sprite based on camera distance to target (zoom level)
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = distanceToTarget * 0.08;
        sprite.scale.set(scale, scale, 1);
        
        return sprite;
    }

    createNumberLabel(value, color) {
        // Format the number - remove unnecessary decimals
        const formattedValue = Math.abs(value) < 0.001 ? '0' : 
                              (value % 1 === 0 ? value.toString() : value.toFixed(1));
        
        // Create canvas for the number
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const isLight = currentTheme === 'light';
        
        // Keep background transparent (don't fill with white)
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Text setup
        context.font = 'bold 80px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Draw text
        if (!isLight) {
            context.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            context.lineWidth = 8;
            context.lineJoin = 'round';
            context.lineCap = 'round';
            context.strokeText(formattedValue, 128, 64);
        }
        context.fillStyle = color;
        context.fillText(formattedValue, 128, 64);
        
        // Create sprite from canvas
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true,
            depthWrite: false,  // Prevent z-fighting with transparent objects
            depthTest: false    // Always render on top
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.renderOrder = 999; // Render after everything else
        
        // Scale based on camera distance for consistent screen size
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = this.getAxisNumberLabelScale(distanceToTarget);
        sprite.scale.set(scale * 2, scale, 1); // Wider aspect ratio for numbers
        
        return sprite;
    }

    getArrowThickness() {
        // Calculate thickness based on camera distance to target
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        
        if (this.dimension === '2d') {
            // In 2D, scale with distance to maintain constant screen size
            // Using a fixed ratio to camera distance ensures consistent appearance
            const screenConstantScale = distanceToTarget * 0.055;
            return {
                headLength: 0.5 * screenConstantScale,
                headWidth: 0.25 * screenConstantScale
            };
        }
        
        // 3D mode: Calculate thickness based on camera distance to target
        const thicknessScale = distanceToTarget * 0.06;
        
        // Set minimum and maximum thickness to ensure visibility at all zoom levels
        const minThickness = 0.15;
        const maxThickness = 5.0;
        const clampedScale = Math.max(minThickness, Math.min(maxThickness, thicknessScale));
        
        return {
            headLength: 0.5 * clampedScale,
            headWidth: 0.25 * clampedScale
        };
    }

    getVectorSizeModeFactor() {
        return this.vectorSizeMode === 'small' ? 0.75 : 1.0;
    }

    getVectorArrowThickness() {
        const thickness = this.getArrowThickness();
        const factor = this.getVectorSizeModeFactor();
        return {
            headLength: thickness.headLength * factor,
            headWidth: thickness.headWidth * factor
        };
    }

    getInvariantLineRadius() {
        const vectorThickness = this.getVectorArrowThickness();
        const ratio = this.dimension === '2d' ? 0.2 : 0.12;
        return vectorThickness.headWidth * ratio;
    }

    getInvariantLineRenderOrder() {
        return this.dimension === '2d' ? 1002 : 0;
    }

    getPointSpriteTexture() {
        if (this.pointSpriteTexture) {
            return this.pointSpriteTexture;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        context.clearRect(0, 0, 128, 128);
        context.beginPath();
        context.arc(64, 64, 52, 0, Math.PI * 2);
        context.fillStyle = '#ffffff';
        context.fill();

        this.pointSpriteTexture = new THREE.CanvasTexture(canvas);
        this.pointSpriteTexture.needsUpdate = true;
        return this.pointSpriteTexture;
    }

    createVectorPointVisual(color, position) {
        const pointSize = 0.15;

        if (this.dimension === '2d') {
            const spriteMaterial = new THREE.SpriteMaterial({
                map: this.getPointSpriteTexture(),
                color: color,
                transparent: true,
                depthTest: true,
                depthWrite: true
            });
            const pointSprite = new THREE.Sprite(spriteMaterial);
            pointSprite.position.copy(position);
            pointSprite.scale.set(pointSize * 2, pointSize * 2, 1);
            pointSprite.renderOrder = 1;
            return pointSprite;
        }

        const sphereGeometry = new THREE.SphereGeometry(pointSize, 16, 16);
        const sphereMaterial = new THREE.MeshBasicMaterial({
            color: color,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const pointSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        pointSphere.position.copy(position);
        pointSphere.renderOrder = 1;
        return pointSphere;
    }

    getAxisNumberLabelScale(distanceToTarget) {
        const baseScale = distanceToTarget * 0.05; // Existing/current size (large mode)
        const modeFactor = this.vectorSizeMode === 'small' ? 0.75 : 1.0;
        return baseScale * modeFactor;
    }

    createAxisLine(start, end, color, thickness) {
        // Create a simple line (cylinder) for negative axis directions
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        direction.normalize();
        
        const radialSegments = this.dimension === '2d' ? 3 : 16;
        
        const geometry = new THREE.CylinderGeometry(
            thickness,
            thickness,
            length,
            radialSegments,
            1,
            false
        );
        
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            depthWrite: this.dimension === '2d',
            depthTest: this.dimension === '2d',
            polygonOffset: true,
            polygonOffsetFactor: 2,
            polygonOffsetUnits: 2
        });
        
        const cylinder = new THREE.Mesh(geometry, material);
        cylinder.renderOrder = this.dimension === '2d' ? 0 : -1;
        
        // Position at midpoint
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        cylinder.position.copy(midpoint);
        
        // Orient along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
        cylinder.quaternion.copy(quaternion);
        
        return cylinder;
    }

    createSmoothArrow(direction, origin, length, color, headLength = 0.2, headWidth = 0.1) {
        // Create arrow geometry
        const group = new THREE.Group();
        
        // Cap head dimensions to be proportional to vector length to prevent oversized heads on short vectors
        const maxHeadLength = length * 0.25;
        const cappedHeadLength = Math.min(headLength, maxHeadLength);
        
        // Cap head width (cone radius) to be proportional to vector length as well
        const maxHeadWidth = length * 0.125; // 12.5% of vector length
        const cappedHeadWidth = Math.min(headWidth, maxHeadWidth);
        
        const shaftLength = length - cappedHeadLength;
        const shaftRadius = cappedHeadWidth * 0.3;

        if (this.dimension === '2d') {
            const flatDir = direction.clone();
            flatDir.z = 0;
            if (flatDir.lengthSq() < 1e-10) {
                return group;
            }
            flatDir.normalize();

            const material = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                depthWrite: false,
                depthTest: false,
                side: THREE.DoubleSide,
                polygonOffset: true,
                polygonOffsetFactor: -1,
                polygonOffsetUnits: -1
            });

            const shaftWidth = cappedHeadWidth * 0.65;
            const shaftGeometry = new THREE.PlaneGeometry(shaftLength, shaftWidth);
            const shaft = new THREE.Mesh(shaftGeometry, material);
            shaft.position.set(shaftLength / 2, 0, 0);
            shaft.renderOrder = 1006;

            const headShape = new THREE.Shape();
            headShape.moveTo(0, -cappedHeadWidth);
            headShape.lineTo(0, cappedHeadWidth);
            headShape.lineTo(cappedHeadLength, 0);
            headShape.lineTo(0, -cappedHeadWidth);
            const headGeometry = new THREE.ShapeGeometry(headShape);
            const head = new THREE.Mesh(headGeometry, material);
            head.position.set(shaftLength, 0, 0);
            head.renderOrder = 1006;

            group.add(shaft, head);
            group.position.copy(origin);
            group.position.z = 0;
            group.rotation.z = Math.atan2(flatDir.y, flatDir.x);
            group.renderOrder = 1006;
            return group;
        }
        
        // Use smooth radial geometry in both modes to avoid apparent arrow-head morphing during pan
        const radialSegments = 16;
        
        // Shaft - cylinder with segments based on mode
        const shaftGeometry = new THREE.CylinderGeometry(
            shaftRadius, 
            shaftRadius, 
            shaftLength, 
            radialSegments,
            1,
            false
        );
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            depthWrite: true,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -8,
            polygonOffsetUnits: -8
        });

        if (this.dimension === '3d') {
            material.polygonOffset = false;
            material.polygonOffsetFactor = 0;
            material.polygonOffsetUnits = 0;
        }
        const shaft = new THREE.Mesh(shaftGeometry, material);
        shaft.position.copy(direction.clone().multiplyScalar(shaftLength / 2));
        
        // Orient shaft along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());
        shaft.quaternion.copy(quaternion);
        
        // Head - smooth cone
        const headGeometry = new THREE.ConeGeometry(
            cappedHeadWidth, 
            cappedHeadLength, 
            radialSegments,
            1,
            false
        );
        const head = new THREE.Mesh(headGeometry, material);
        head.position.copy(direction.clone().multiplyScalar(shaftLength + cappedHeadLength / 2));
        head.quaternion.copy(quaternion);
        
        group.add(shaft, head);
        group.position.copy(origin);
        group.renderOrder = 1; // Render after axes while preserving normal depth occlusion
        
        return group;
    }

    createSmoothArrowHead(direction, position, color, headLength = 0.2, headWidth = 0.1) {
        if (this.dimension === '2d') {
            const flatDir = direction.clone();
            flatDir.z = 0;
            if (flatDir.lengthSq() < 1e-10) {
                return new THREE.Group();
            }
            flatDir.normalize();

            const material = new THREE.MeshBasicMaterial({
                color: color,
                depthWrite: true,
                depthTest: true,
                side: THREE.DoubleSide
            });
            const headShape = new THREE.Shape();
            headShape.moveTo(0, -headWidth);
            headShape.lineTo(0, headWidth);
            headShape.lineTo(headLength, 0);
            headShape.lineTo(0, -headWidth);
            const head = new THREE.Mesh(new THREE.ShapeGeometry(headShape), material);
            head.position.copy(flatDir.multiplyScalar(position));
            head.rotation.z = Math.atan2(flatDir.y, flatDir.x);
            return head;
        }

        // Create just an arrow head at a specific position along the direction
        const radialSegments = 16;
        
        const headGeometry = new THREE.ConeGeometry(
            headWidth, 
            headLength, 
            radialSegments,
            1,
            false
        );
        const material = new THREE.MeshBasicMaterial({ 
            color: color,
            depthWrite: true,
            depthTest: true
        });
        const head = new THREE.Mesh(headGeometry, material);
        
        // Position the arrow head at the specified distance along the direction
        head.position.copy(direction.clone().normalize().multiplyScalar(position));
        
        // Orient along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());
        head.quaternion.copy(quaternion);
        
        return head;
    }

    initializeDefaultContent() {
        // Initialize 2D mode with a 90° rotation matrix and unit square
        this.addMatrix();
        // Set to 90° rotation: [[0, -1], [1, 0]]
        if (this.matrices2D.length > 0) {
            this.matrices2D[0].values = [[0, -1], [1, 0]];
        }
        // Add unit square vectors using preset edge metadata
        this.addPresetVectors('preset-square');
        
        // Pre-initialize 3D mode data (without adding to scene)
        // Add matrix data directly - composite rotation in 2 dimensions
        const matrix3D = {
            id: this.nextMatrixId++,
            name: 'A',
            values: [[0, 1, 0], [0, 0, -1], [-1, 0, 0]], // 90° rotation about X then Y
            color: new THREE.Color(0x904AE2)
        };
        this.matrices3D.push(matrix3D);
        this.usedMatrixLetters3D.add('A');
        this.selectedMatrixId3D = matrix3D.id;
        
        // Pre-store unit cube vectors for 3D (will be created when switching to 3D)
        const cubeVertices = [
            [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
            [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
        ];
        
        const cubeVectors = [];
        cubeVertices.forEach(coords => {
            const colorHex = this.vectorColors[this.colorIndex3D % this.vectorColors.length];
            this.colorIndex3D++;
            
            const vector3D = {
                arrow: null,
                pointSphere: null,
                name: `V${cubeVectors.length + 1}`,
                originalEnd: new THREE.Vector3(coords[0], coords[1], coords[2]),
                currentEnd: new THREE.Vector3(coords[0], coords[1], coords[2]),
                color: new THREE.Color(colorHex),
                id: this.nextVectorId++,
                visible: true
            };
            this.vectors3D.push(vector3D);
            cubeVectors.push(vector3D);
        });

        // Store default cube edges so 3D startup matches preset behavior
        const cubeEdgeIndexPairs = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        this.presetEdges3D = cubeEdgeIndexPairs.map(([startIndex, endIndex]) => ({
            startId: cubeVectors[startIndex].id,
            endId: cubeVectors[endIndex].id
        }));

        const cubeFaceIndexTriples = [
            [0, 1, 2], [0, 2, 3],
            [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4],
            [1, 2, 6], [1, 6, 5],
            [2, 3, 7], [2, 7, 6],
            [3, 0, 4], [3, 4, 7]
        ];
        this.presetFaces3D = cubeFaceIndexTriples.map(([aIndex, bIndex, cIndex]) => ({
            aId: cubeVectors[aIndex].id,
            bId: cubeVectors[bIndex].id,
            cId: cubeVectors[cIndex].id
        }));
        
        // Update the display for 2D mode
        this.updateObjectsList();
    }

    initEventListeners() {
        const withSignal = (options = {}) => ({
            ...options,
            signal: this.eventAbortController.signal
        });

        // Panel toggle button
        const panelToggleBtn = document.getElementById('panel-toggle-btn');
        const controlPanel = document.querySelector('.control-panel');
        
        // Track panel interactions for analytics
        if (controlPanel) {
            let penPanelPointer = null;
            const penActionSelector = 'button, .dropdown-item, .color-indicator, .object-group-header, input, textarea, select, [contenteditable="true"], [role="button"]';

            const trackPanelInteraction = () => {
                const now = Date.now();
                if (typeof gtag !== 'undefined' && (now - this.lastPanelEvent) >= this.analyticsThrottleMs) {
                    gtag('event', 'VECTOR_panel_interaction', {
                        'event_category': 'engagement',
                        'event_label': this.dimension
                    });
                    this.lastPanelEvent = now;
                }
            };
            
            controlPanel.addEventListener('click', () => trackPanelInteraction(), withSignal({ passive: true }));
            controlPanel.addEventListener('touchstart', (e) => {
                trackPanelInteraction();
                e.stopPropagation(); // Prevent touch from bubbling to canvas/document
            }, withSignal({ passive: true }));

            controlPanel.addEventListener('pointerdown', (e) => {
                if (e.pointerType !== 'pen') {
                    return;
                }

                const actionTarget = e.target && typeof e.target.closest === 'function'
                    ? e.target.closest(penActionSelector)
                    : null;

                if (!actionTarget) {
                    penPanelPointer = null;
                    return;
                }

                penPanelPointer = {
                    id: e.pointerId,
                    x: e.clientX,
                    y: e.clientY,
                    target: actionTarget
                };
            }, withSignal({ passive: true }));

            controlPanel.addEventListener('pointerup', (e) => {
                if (e.pointerType !== 'pen' || !penPanelPointer || penPanelPointer.id !== e.pointerId) {
                    return;
                }

                const actionTarget = e.target && typeof e.target.closest === 'function'
                    ? e.target.closest(penActionSelector)
                    : null;
                const dx = e.clientX - penPanelPointer.x;
                const dy = e.clientY - penPanelPointer.y;
                const tapThreshold = 12;
                const isTap = (dx * dx + dy * dy) <= (tapThreshold * tapThreshold);
                const sameTarget = actionTarget === penPanelPointer.target ||
                    (penPanelPointer.target && penPanelPointer.target.contains(e.target));

                if (isTap && sameTarget && penPanelPointer.target) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (typeof penPanelPointer.target.focus === 'function') {
                        penPanelPointer.target.focus({ preventScroll: true });
                    }

                    penPanelPointer.target.click();
                }

                penPanelPointer = null;
            }, withSignal({ passive: false }));

            controlPanel.addEventListener('pointercancel', () => {
                penPanelPointer = null;
            }, withSignal({ passive: true }));
            
            controlPanel.addEventListener('touchmove', (e) => {
                // If panel is not scrollable (no overflow), prevent default to stop rubber banding
                const isScrollable = controlPanel.scrollHeight > controlPanel.clientHeight;
                if (!isScrollable) {
                    e.preventDefault();
                }
                e.stopPropagation(); // Prevent touch from bubbling to canvas/document
            }, withSignal({ passive: false })); // Non-passive to allow preventDefault
            
            controlPanel.addEventListener('touchend', (e) => {
                e.stopPropagation(); // Prevent touch from bubbling to canvas/document
            }, withSignal({ passive: true }));
        }
        
        panelToggleBtn.onclick = () => {
            this.panelOpen = !this.panelOpen;
            controlPanel.classList.toggle('closed');
            panelToggleBtn.classList.toggle('active');
            
            // Trigger lightweight resize after panel animation completes
            // Use requestAnimationFrame to avoid blocking the UI
            setTimeout(() => {
                requestAnimationFrame(() => {
                    this.onPanelResize();
                });
            }, 300);
        };
        
        // Auto-close panel on canvas tap for phones and iPad portrait
        this.canvas.addEventListener('touchstart', (e) => {
            // Exclude touches that start on control panel to prevent rubber banding
            if (e.target.closest('.control-panel')) {
                return;
            }
            
            const isPhoneNarrow = window.innerWidth < 768;
            const isIPadPortrait = Boolean(
                this.deviceInfo &&
                this.deviceInfo.isIPad &&
                window.innerHeight > window.innerWidth
            );

            if ((isPhoneNarrow || isIPadPortrait) && this.panelOpen) {
                this.panelOpen = false;
                controlPanel.classList.add('closed');
                panelToggleBtn.classList.remove('active');
                
                // Trigger lightweight resize after panel animation completes
                setTimeout(() => {
                    requestAnimationFrame(() => {
                        this.onPanelResize();
                    });
                }, 300);
            }
        }, withSignal({ passive: true }));
        
        // Top button row - Reset axes
        document.getElementById('reset-axes-btn').addEventListener('click', () => {
            this.closePanelOnMobile();
            this.resetView();
        }, withSignal());

        const closeEigenvaluePanelBtn = document.getElementById('close-eigenvalue-panel-btn');
        if (closeEigenvaluePanelBtn) {
            closeEigenvaluePanelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.eigenvaluePanelMatrixId) {
                    this.showMatrixInfo(this.eigenvaluePanelMatrixId);
                }
            }, withSignal());
        }

        const closeVectorInfoPanelBtn = document.getElementById('close-vector-info-panel-btn');
        if (closeVectorInfoPanelBtn) {
            closeVectorInfoPanelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.vectorInfoPanelId) {
                    this.showVectorInfo(this.vectorInfoPanelId);
                }
            }, withSignal());
        }

        const closeLineInfoPanelBtn = document.getElementById('close-line-info-panel-btn');
        if (closeLineInfoPanelBtn) {
            closeLineInfoPanelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.lineInfoPanelId) {
                    this.showLineInfo(this.lineInfoPanelId);
                }
            }, withSignal());
        }

        const closePlaneInfoPanelBtn = document.getElementById('close-plane-info-panel-btn');
        if (closePlaneInfoPanelBtn) {
            closePlaneInfoPanelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.planeInfoPanelId) {
                    this.showPlaneInfo(this.planeInfoPanelId);
                }
            }, withSignal());
        }
        
        // Top button row - Add button opens dropdown
        document.getElementById('add-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('add-dropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }, withSignal());
        
        // Add dropdown - item click handler
        document.querySelectorAll('#add-dropdown .dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-action');
                
                if (action === 'add-vector') {
                    // Add a blank vector with default coordinates
                    if (this.dimension === '2d') {
                        this.addVector(1, 1, 0);
                    } else {
                        this.addVector(1, 1, 1);
                    }
                } else if (action === 'add-matrix') {
                    this.addMatrix();
                } else if (action === 'add-line') {
                    this.addLine();
                } else if (action === 'add-plane') {
                    if (this.dimension === '3d') {
                        this.addPlane();
                    }
                } else if (action.startsWith('rotation-') || action.startsWith('scale-') || 
                           action.startsWith('shear-') || action.startsWith('reflection-')) {
                    // Add a preset matrix
                    this.addPresetMatrix(action);
                } else if (action.startsWith('preset-')) {
                    // Add preset vector group
                    this.addPresetVectors(action);
                }
                
                // Close dropdown
                document.getElementById('add-dropdown').style.display = 'none';
            }, withSignal());
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            document.getElementById('add-dropdown').style.display = 'none';
        }, withSignal());
        
        // Second button row - Grid toggle
        document.getElementById('grid-toggle-btn').addEventListener('click', () => this.toggleGrid(), withSignal());

        // Bottom row - Intersections toggle
        const intersectionToggleBtn = document.getElementById('intersection-toggle-btn');
        if (intersectionToggleBtn) {
            intersectionToggleBtn.addEventListener('click', () => this.toggleIntersections(), withSignal());
        }

        const returnToTitleButton = document.getElementById('return-to-title');
        if (returnToTitleButton) {
            returnToTitleButton.onclick = () => {
                this.toggleShortcutsOverlay(false);
                returnToTitleScreen();
            };
        }

        const helpButtonPanel = document.getElementById('help-button');
        if (helpButtonPanel) {
            helpButtonPanel.onclick = () => {
                this.toggleShortcutsOverlay();
            };
        }

        const shortcutsOverlay = document.getElementById('shortcuts-overlay');
        if (shortcutsOverlay) {
            shortcutsOverlay.onclick = (e) => {
                if (e.target === shortcutsOverlay) {
                    this.toggleShortcutsOverlay(false);
                }
            };
        }
        
        // Second button row - Dimension toggle
        document.getElementById('dimension-toggle-btn').addEventListener('click', () => this.toggleDimension(), withSignal());
        
        // Third button row - Vector display mode toggle
        document.getElementById('vector-display-toggle-btn').addEventListener('click', () => this.toggleVectorDisplayMode(), withSignal());

        // Bottom row - Vector size mode toggle
        const vectorSizeToggleBtn = document.getElementById('vector-size-toggle-btn');
        if (vectorSizeToggleBtn) {
            vectorSizeToggleBtn.addEventListener('click', () => this.toggleVectorSizeMode(), withSignal());
            this.updateVectorSizeModeUI();
            this.updateInfoPanelsSizeModeUI();
        }

        const planeExtentSlider = document.getElementById('plane-extent-slider');
        if (planeExtentSlider) {
            planeExtentSlider.value = String(this.planeExtent);
            planeExtentSlider.addEventListener('input', (e) => {
                const nextExtent = this.toFiniteNumber(e.target.value, 10);
                this.planeExtent = Math.max(5, Math.min(100, nextExtent));
                this.updatePlaneExtentControl();
                this.planes.forEach(plane => this.renderPlane(plane));
                this.updateIntersections();
                this.scheduleStateSave();
            }, withSignal());
        }

        // Canvas drag to add vectors
        this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e), withSignal());
        this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e), withSignal());
        this.canvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e), withSignal());
        this.canvas.addEventListener('mouseleave', (e) => this.onCanvasMouseUp(e), withSignal());
        
        // Keyboard zoom and pan controls
        document.addEventListener('keydown', (e) => {
            // Only handle if app is initialized and not typing in an input field
            if (!window.vectoramaApp || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }
            
            // Check for zoom in keys: + (Equal key) or NumpadAdd
            if (e.code === 'Equal' || e.code === 'NumpadAdd') {
                e.preventDefault();
                this.zoomCamera(0.9); // Zoom in (reduce distance by 10%)
            }
            // Check for zoom out keys: - (Minus key) or NumpadSubtract  
            else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
                e.preventDefault();
                this.zoomCamera(1.1); // Zoom out (increase distance by 10%)
            }
            // Arrow keys for panning
            else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                e.preventDefault();
                
                // Pan distance proportional to current zoom level
                const distance = this.camera.position.distanceTo(this.controls.target);
                const panAmount = distance * 0.1; // 10% of current distance
                
                if (e.code === 'ArrowUp') {
                    this.panCamera(0, panAmount, 0);
                } else if (e.code === 'ArrowDown') {
                    this.panCamera(0, -panAmount, 0);
                } else if (e.code === 'ArrowLeft') {
                    this.panCamera(-panAmount, 0, 0);
                } else if (e.code === 'ArrowRight') {
                    this.panCamera(panAmount, 0, 0);
                }
            }
        }, withSignal());
        
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault(), withSignal());

        // Matrix input changes
        this.addMatrixInputListeners();
        
        // Initialize dropdown visibility based on starting dimension
        this.updateDropdownVisibility();
        this.updateGridToggleUI();
        this.updateIntersectionsToggleUI();
        this.updatePlaneExtentControl();
        this.updateVectorDisplayModeUI();
    }

    toggleShortcutsOverlay(forceState = null) {
        const overlay = document.getElementById('shortcuts-overlay');
        if (!overlay) return;

        const shouldShow = forceState === null ? !overlay.classList.contains('show') : Boolean(forceState);

        if (shouldShow) {
            const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches
                || navigator.maxTouchPoints > 0
                || 'ontouchstart' in window;
            overlay.classList.toggle('touch-navigation-mode', isTouchDevice);
            overlay.classList.add('show');
        } else {
            overlay.classList.remove('show');
            if (document.activeElement) {
                document.activeElement.blur();
            }
        }
    }
    
    trackEngagement() {
        // Throttled Google Analytics event for user engagement tracking
        // Only sends event if gtag exists and throttle period has elapsed
        const now = Date.now();
        if (typeof gtag !== 'undefined' && (now - this.lastAnalyticsEvent) >= this.analyticsThrottleMs) {
            gtag('event', 'VECTOR_interaction', {
                'event_category': 'engagement',
                'event_label': this.dimension
            });
            this.lastAnalyticsEvent = now;
        }
    }

    addMatrixInputListeners() {
        // Listen to all matrix inputs for live preview
        const inputs = document.querySelectorAll('.matrix-grid input');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                // Update invariant space visualization when matrix changes
                this.visualizeInvariantSpaces();
            }, {
                signal: this.eventAbortController.signal
            });
        });
    }

    cleanup() {
        if (this.isDestroyed) {
            return;
        }

        this.isDestroyed = true;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.eventAbortController) {
            this.eventAbortController.abort();
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        if (this.stateSaveTimeout) {
            clearTimeout(this.stateSaveTimeout);
            this.stateSaveTimeout = null;
        }

        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = null;
        }

        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
            this.updateTimeout = null;
        }

        this.toggleShortcutsOverlay(false);

        if (this.controls) {
            this.controls.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
        }
    }

    updateDropdownVisibility() {
        // Show/hide dropdown items based on current dimension
        document.querySelectorAll('.preset-2d').forEach(el => {
            el.style.display = this.dimension === '2d' ? 'block' : 'none';
        });
        document.querySelectorAll('.preset-3d').forEach(el => {
            el.style.display = this.dimension === '3d' ? 'block' : 'none';
        });
        document.querySelectorAll('.action-3d').forEach(el => {
            el.style.display = this.dimension === '3d' ? 'block' : 'none';
        });
    }

    getDefaultGroupCollapsedState() {
        return {
            matrices: true,
            planes: true,
            lines: true,
            vectors: true
        };
    }

    toFiniteNumber(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    normalizeDimension(value) {
        return value === '3d' ? '3d' : '2d';
    }

    normalizePlaneFormPreference(value) {
        if (value === 'cartesian') return 'cartesian';
        if (value === 'vector') return 'vector';
        if (value === 'scalar') return 'scalar';
        if (value === 'dot') return 'dot';
        return 'dot';
    }

    getNextPlaneFormPreference(value) {
        const normalized = this.normalizePlaneFormPreference(value);
        if (normalized === 'dot') return 'cartesian';
        if (normalized === 'cartesian') return 'vector';
        if (normalized === 'vector') return 'scalar';
        return 'dot';
    }

    normalizeLineFormPreference(value) {
        if (value === 'cross') return 'cross';
        if (value === 'cartesian') return 'cartesian';
        return 'parametric';
    }

    serializeColor(colorValue, fallback = '#4A90E2') {
        if (colorValue && colorValue.isColor) {
            return `#${colorValue.getHexString()}`;
        }
        if (typeof colorValue === 'string' && colorValue.trim()) {
            return colorValue;
        }
        return fallback;
    }

    serializeVector(vector) {
        return {
            id: this.toFiniteNumber(vector.id, 0),
            name: vector.name || null,
            visible: vector.visible !== false,
            color: this.serializeColor(vector.color),
            originalEnd: {
                x: this.toFiniteNumber(vector.originalEnd?.x, 0),
                y: this.toFiniteNumber(vector.originalEnd?.y, 0),
                z: this.toFiniteNumber(vector.originalEnd?.z, 0)
            },
            currentEnd: {
                x: this.toFiniteNumber(vector.currentEnd?.x, 0),
                y: this.toFiniteNumber(vector.currentEnd?.y, 0),
                z: this.toFiniteNumber(vector.currentEnd?.z, 0)
            }
        };
    }

    deserializeVectors(vectors = []) {
        return vectors.map((vector, index) => {
            const originalEnd = new THREE.Vector3(
                this.toFiniteNumber(vector?.originalEnd?.x, 0),
                this.toFiniteNumber(vector?.originalEnd?.y, 0),
                this.toFiniteNumber(vector?.originalEnd?.z, 0)
            );
            const currentEnd = new THREE.Vector3(
                this.toFiniteNumber(vector?.currentEnd?.x, originalEnd.x),
                this.toFiniteNumber(vector?.currentEnd?.y, originalEnd.y),
                this.toFiniteNumber(vector?.currentEnd?.z, originalEnd.z)
            );

            let color = null;
            try {
                color = new THREE.Color(this.serializeColor(vector?.color));
            } catch {
                color = new THREE.Color(this.vectorColors[index % this.vectorColors.length]);
            }

            return {
                id: this.toFiniteNumber(vector?.id, index + 1),
                name: vector?.name || `V${index + 1}`,
                visible: vector?.visible !== false,
                color,
                originalEnd,
                currentEnd,
                arrow: null,
                pointSphere: null,
                labelSprite: null
            };
        });
    }

    serializeMatrix(matrix) {
        return {
            id: this.toFiniteNumber(matrix.id, 0),
            name: matrix.name || null,
            values: Array.isArray(matrix.values) ? matrix.values : [],
            color: this.serializeColor(matrix.color, '#904AE2')
        };
    }

    deserializeMatrices(matrices = [], defaultSize = 2) {
        return matrices.map((matrix, index) => {
            const size = Math.max(2, Math.min(3, Array.isArray(matrix?.values) ? matrix.values.length : defaultSize));
            const values = [];
            for (let row = 0; row < size; row++) {
                values[row] = [];
                for (let col = 0; col < size; col++) {
                    values[row][col] = this.toFiniteNumber(matrix?.values?.[row]?.[col], row === col ? 1 : 0);
                }
            }

            let color = null;
            try {
                color = new THREE.Color(this.serializeColor(matrix?.color, '#904AE2'));
            } catch {
                color = new THREE.Color(0x904AE2);
            }

            return {
                id: this.toFiniteNumber(matrix?.id, index + 1),
                name: matrix?.name || null,
                values,
                color
            };
        });
    }

    serializeLine(line) {
        return {
            id: this.toFiniteNumber(line.id, 0),
            name: line.name || null,
            color: this.serializeColor(line.color),
            visible: line.visible !== false,
            point: {
                x: this.toFiniteNumber(line.point?.x, 0),
                y: this.toFiniteNumber(line.point?.y, 0),
                z: this.toFiniteNumber(line.point?.z, 0)
            },
            direction: {
                x: this.toFiniteNumber(line.direction?.x, 0),
                y: this.toFiniteNumber(line.direction?.y, 0),
                z: this.toFiniteNumber(line.direction?.z, 0)
            },
            originalPoint: {
                x: this.toFiniteNumber(line.originalPoint?.x, line.point?.x),
                y: this.toFiniteNumber(line.originalPoint?.y, line.point?.y),
                z: this.toFiniteNumber(line.originalPoint?.z, line.point?.z)
            },
            originalDirection: {
                x: this.toFiniteNumber(line.originalDirection?.x, line.direction?.x),
                y: this.toFiniteNumber(line.originalDirection?.y, line.direction?.y),
                z: this.toFiniteNumber(line.originalDirection?.z, line.direction?.z)
            },
            currentPoint: {
                x: this.toFiniteNumber(line.currentPoint?.x, line.point?.x),
                y: this.toFiniteNumber(line.currentPoint?.y, line.point?.y),
                z: this.toFiniteNumber(line.currentPoint?.z, line.point?.z)
            },
            currentDirection: {
                x: this.toFiniteNumber(line.currentDirection?.x, line.direction?.x),
                y: this.toFiniteNumber(line.currentDirection?.y, line.direction?.y),
                z: this.toFiniteNumber(line.currentDirection?.z, line.direction?.z)
            },
            formPreference: this.normalizeLineFormPreference(line.formPreference)
        };
    }

    deserializeLines(lines = []) {
        return lines.map((line, index) => ({
            id: this.toFiniteNumber(line?.id, index + 1),
            name: line?.name || `L${index + 1}`,
            color: this.serializeColor(line?.color),
            visible: line?.visible !== false,
            point: {
                x: this.toFiniteNumber(line?.point?.x, 0),
                y: this.toFiniteNumber(line?.point?.y, 0),
                z: this.toFiniteNumber(line?.point?.z, 0)
            },
            direction: {
                x: this.toFiniteNumber(line?.direction?.x, 1),
                y: this.toFiniteNumber(line?.direction?.y, 0),
                z: this.toFiniteNumber(line?.direction?.z, 0)
            },
            originalPoint: {
                x: this.toFiniteNumber(line?.originalPoint?.x, line?.point?.x),
                y: this.toFiniteNumber(line?.originalPoint?.y, line?.point?.y),
                z: this.toFiniteNumber(line?.originalPoint?.z, line?.point?.z)
            },
            originalDirection: {
                x: this.toFiniteNumber(line?.originalDirection?.x, line?.direction?.x),
                y: this.toFiniteNumber(line?.originalDirection?.y, line?.direction?.y),
                z: this.toFiniteNumber(line?.originalDirection?.z, line?.direction?.z)
            },
            currentPoint: {
                x: this.toFiniteNumber(line?.currentPoint?.x, line?.point?.x),
                y: this.toFiniteNumber(line?.currentPoint?.y, line?.point?.y),
                z: this.toFiniteNumber(line?.currentPoint?.z, line?.point?.z)
            },
            currentDirection: {
                x: this.toFiniteNumber(line?.currentDirection?.x, line?.direction?.x),
                y: this.toFiniteNumber(line?.currentDirection?.y, line?.direction?.y),
                z: this.toFiniteNumber(line?.currentDirection?.z, line?.direction?.z)
            },
            formPreference: this.normalizeLineFormPreference(line?.formPreference),
            mesh: null
        }));
    }

    serializePlane(plane) {
        return {
            id: this.toFiniteNumber(plane.id, 0),
            name: plane.name || null,
            color: this.serializeColor(plane.color),
            visible: plane.visible !== false,
            a: this.toFiniteNumber(plane.a, 0),
            b: this.toFiniteNumber(plane.b, 0),
            c: this.toFiniteNumber(plane.c, 1),
            d: this.toFiniteNumber(plane.d, 0),
            originalA: this.toFiniteNumber(plane.originalA, plane.a),
            originalB: this.toFiniteNumber(plane.originalB, plane.b),
            originalC: this.toFiniteNumber(plane.originalC, plane.c),
            originalD: this.toFiniteNumber(plane.originalD, plane.d),
            currentA: this.toFiniteNumber(plane.currentA, plane.a),
            currentB: this.toFiniteNumber(plane.currentB, plane.b),
            currentC: this.toFiniteNumber(plane.currentC, plane.c),
            currentD: this.toFiniteNumber(plane.currentD, plane.d),
            formPreference: this.normalizePlaneFormPreference(plane.formPreference)
        };
    }

    deserializePlanes(planes = []) {
        return planes.map((plane, index) => ({
            id: this.toFiniteNumber(plane?.id, index + 1),
            name: plane?.name || `P${index + 1}`,
            color: this.serializeColor(plane?.color),
            visible: plane?.visible !== false,
            a: this.toFiniteNumber(plane?.a, 0),
            b: this.toFiniteNumber(plane?.b, 0),
            c: this.toFiniteNumber(plane?.c, 1),
            d: this.toFiniteNumber(plane?.d, 0),
            originalA: this.toFiniteNumber(plane?.originalA, plane?.a),
            originalB: this.toFiniteNumber(plane?.originalB, plane?.b),
            originalC: this.toFiniteNumber(plane?.originalC, plane?.c),
            originalD: this.toFiniteNumber(plane?.originalD, plane?.d),
            currentA: this.toFiniteNumber(plane?.currentA, plane?.a),
            currentB: this.toFiniteNumber(plane?.currentB, plane?.b),
            currentC: this.toFiniteNumber(plane?.currentC, plane?.c),
            currentD: this.toFiniteNumber(plane?.currentD, plane?.d),
            formPreference: this.normalizePlaneFormPreference(plane?.formPreference),
            mesh: null
        }));
    }

    serializeCameraState(cameraState) {
        if (!cameraState) return null;
        return {
            position: {
                x: this.toFiniteNumber(cameraState.position?.x, 0),
                y: this.toFiniteNumber(cameraState.position?.y, 0),
                z: this.toFiniteNumber(cameraState.position?.z, 10)
            },
            quaternion: {
                x: this.toFiniteNumber(cameraState.quaternion?.x, 0),
                y: this.toFiniteNumber(cameraState.quaternion?.y, 0),
                z: this.toFiniteNumber(cameraState.quaternion?.z, 0),
                w: this.toFiniteNumber(cameraState.quaternion?.w, 1)
            },
            target: {
                x: this.toFiniteNumber(cameraState.target?.x, 0),
                y: this.toFiniteNumber(cameraState.target?.y, 0),
                z: this.toFiniteNumber(cameraState.target?.z, 0)
            },
            fov: this.toFiniteNumber(cameraState.fov, this.camera.fov)
        };
    }

    deserializeCameraState(cameraState) {
        if (!cameraState) return null;
        return {
            position: {
                x: this.toFiniteNumber(cameraState.position?.x, 0),
                y: this.toFiniteNumber(cameraState.position?.y, 0),
                z: this.toFiniteNumber(cameraState.position?.z, 10)
            },
            quaternion: {
                x: this.toFiniteNumber(cameraState.quaternion?.x, 0),
                y: this.toFiniteNumber(cameraState.quaternion?.y, 0),
                z: this.toFiniteNumber(cameraState.quaternion?.z, 0),
                w: this.toFiniteNumber(cameraState.quaternion?.w, 1)
            },
            target: {
                x: this.toFiniteNumber(cameraState.target?.x, 0),
                y: this.toFiniteNumber(cameraState.target?.y, 0),
                z: this.toFiniteNumber(cameraState.target?.z, 0)
            },
            fov: this.toFiniteNumber(cameraState.fov, this.camera.fov)
        };
    }

    captureCurrentCameraState() {
        const state = {
            position: {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            },
            quaternion: {
                x: this.camera.quaternion.x,
                y: this.camera.quaternion.y,
                z: this.camera.quaternion.z,
                w: this.camera.quaternion.w
            },
            target: {
                x: this.controls.target.x,
                y: this.controls.target.y,
                z: this.controls.target.z
            },
            fov: this.camera.fov
        };

        if (this.dimension === '2d') {
            this.cameraState2D = state;
        } else {
            this.cameraState3D = state;
        }
    }

    getCameraStateForDimension(dimension) {
        return dimension === '3d' ? this.cameraState3D : this.cameraState2D;
    }

    applyCameraState(cameraState) {
        if (!cameraState) return;

        this.camera.position.set(
            this.toFiniteNumber(cameraState.position?.x, this.camera.position.x),
            this.toFiniteNumber(cameraState.position?.y, this.camera.position.y),
            this.toFiniteNumber(cameraState.position?.z, this.camera.position.z)
        );
        this.camera.quaternion.set(
            this.toFiniteNumber(cameraState.quaternion?.x, this.camera.quaternion.x),
            this.toFiniteNumber(cameraState.quaternion?.y, this.camera.quaternion.y),
            this.toFiniteNumber(cameraState.quaternion?.z, this.camera.quaternion.z),
            this.toFiniteNumber(cameraState.quaternion?.w, this.camera.quaternion.w)
        );
        this.controls.target.set(
            this.toFiniteNumber(cameraState.target?.x, this.controls.target.x),
            this.toFiniteNumber(cameraState.target?.y, this.controls.target.y),
            this.toFiniteNumber(cameraState.target?.z, this.controls.target.z)
        );
        this.camera.fov = this.toFiniteNumber(cameraState.fov, this.camera.fov);
        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    syncDimensionStateRefs() {
        if (this.dimension === '2d') {
            this.vectors2D = this.vectors;
            this.matrices2D = this.matrices;
            this.lines2D = this.lines;
            this.presetEdges2D = this.presetEdges;
            this.presetEdgeMeshes2D = this.presetEdgeMeshes;
            this.presetFaces2D = this.presetFaces;
            this.presetFaceMeshes2D = this.presetFaceMeshes;
            this.usedMatrixLetters2D = this.usedMatrixLetters;
            this.selectedMatrixId2D = this.selectedMatrixId;
            this.colorIndex2D = this.colorIndex;
        } else {
            this.vectors3D = this.vectors;
            this.matrices3D = this.matrices;
            this.lines3D = this.lines;
            this.planes3D = this.planes;
            this.presetEdges3D = this.presetEdges;
            this.presetEdgeMeshes3D = this.presetEdgeMeshes;
            this.presetFaces3D = this.presetFaces;
            this.presetFaceMeshes3D = this.presetFaceMeshes;
            this.usedMatrixLetters3D = this.usedMatrixLetters;
            this.selectedMatrixId3D = this.selectedMatrixId;
            this.colorIndex3D = this.colorIndex;
        }
    }

    buildAppStateSnapshot() {
        this.captureCurrentCameraState();
        this.syncDimensionStateRefs();

        return {
            version: 1,
            dimension: this.dimension,
            vectorDisplayMode: this.vectorDisplayMode,
            currentGridSpacing: this.currentGridSpacing,
            counters: {
                nextVectorId: this.nextVectorId,
                nextMatrixId: this.nextMatrixId,
                nextLineId: this.nextLineId,
                nextPlaneId: this.nextPlaneId
            },
            colorIndex2D: this.colorIndex2D,
            colorIndex3D: this.colorIndex3D,
            selectedMatrixId2D: this.selectedMatrixId2D,
            selectedMatrixId3D: this.selectedMatrixId3D,
            usedMatrixLetters2D: Array.from(this.usedMatrixLetters2D),
            usedMatrixLetters3D: Array.from(this.usedMatrixLetters3D),
            vectors2D: this.vectors2D.map(v => this.serializeVector(v)),
            vectors3D: this.vectors3D.map(v => this.serializeVector(v)),
            matrices2D: this.matrices2D.map(m => this.serializeMatrix(m)),
            matrices3D: this.matrices3D.map(m => this.serializeMatrix(m)),
            lines2D: this.lines2D.map(l => this.serializeLine(l)),
            lines3D: this.lines3D.map(l => this.serializeLine(l)),
            planes3D: this.planes3D.map(p => this.serializePlane(p)),
            presetEdges2D: Array.isArray(this.presetEdges2D) ? this.presetEdges2D.map(edge => ({
                startId: this.toFiniteNumber(edge?.startId, 0),
                endId: this.toFiniteNumber(edge?.endId, 0)
            })) : [],
            presetEdges3D: Array.isArray(this.presetEdges3D) ? this.presetEdges3D.map(edge => ({
                startId: this.toFiniteNumber(edge?.startId, 0),
                endId: this.toFiniteNumber(edge?.endId, 0)
            })) : [],
            presetFaces2D: Array.isArray(this.presetFaces2D) ? this.presetFaces2D.map(face => ({
                aId: this.toFiniteNumber(face?.aId, 0),
                bId: this.toFiniteNumber(face?.bId, 0),
                cId: this.toFiniteNumber(face?.cId, 0)
            })) : [],
            presetFaces3D: Array.isArray(this.presetFaces3D) ? this.presetFaces3D.map(face => ({
                aId: this.toFiniteNumber(face?.aId, 0),
                bId: this.toFiniteNumber(face?.bId, 0),
                cId: this.toFiniteNumber(face?.cId, 0)
            })) : [],
            cameraState2D: this.serializeCameraState(this.cameraState2D),
            cameraState3D: this.serializeCameraState(this.cameraState3D)
        };
    }

    saveAppState() {
        try {
            const snapshot = this.buildAppStateSnapshot();
            localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(snapshot));
        } catch (error) {
            console.warn('Failed to save app state:', error);
        }
    }

    scheduleStateSave() {
        if (this.stateSaveTimeout) {
            clearTimeout(this.stateSaveTimeout);
        }

        this.stateSaveTimeout = setTimeout(() => {
            this.stateSaveTimeout = null;
            this.saveAppState();
        }, 200);
    }

    restoreAppState() {
        let rawState = null;
        try {
            rawState = localStorage.getItem(APP_STATE_STORAGE_KEY);
        } catch {
            return false;
        }

        if (!rawState) return false;

        let state = null;
        try {
            state = JSON.parse(rawState);
        } catch {
            return false;
        }

        if (!state || typeof state !== 'object') return false;

        this.groupCollapsed = this.getDefaultGroupCollapsedState();

        this.vectorDisplayMode = state.vectorDisplayMode === 'vectors' ? 'vectors' : 'points';
        // Session defaults (not persisted)
        this.vectorSizeMode = 'small';
        this.gridVisible = true;
        this.intersectionsVisible = true;
        this.planeExtent = 10;
        this.currentGridSpacing = this.toFiniteNumber(state.currentGridSpacing, 1);

        this.vectors2D = this.deserializeVectors(state.vectors2D || []);
        this.vectors3D = this.deserializeVectors(state.vectors3D || []);
        this.matrices2D = this.deserializeMatrices(state.matrices2D || [], 2);
        this.matrices3D = this.deserializeMatrices(state.matrices3D || [], 3);
        this.lines2D = this.deserializeLines(state.lines2D || []);
        this.lines3D = this.deserializeLines(state.lines3D || []);
        this.planes3D = this.deserializePlanes(state.planes3D || []);

        this.presetEdges2D = Array.isArray(state.presetEdges2D) ? state.presetEdges2D.map(edge => ({
            startId: this.toFiniteNumber(edge?.startId, 0),
            endId: this.toFiniteNumber(edge?.endId, 0)
        })) : [];
        this.presetEdges3D = Array.isArray(state.presetEdges3D) ? state.presetEdges3D.map(edge => ({
            startId: this.toFiniteNumber(edge?.startId, 0),
            endId: this.toFiniteNumber(edge?.endId, 0)
        })) : [];
        this.presetFaces2D = Array.isArray(state.presetFaces2D) ? state.presetFaces2D.map(face => ({
            aId: this.toFiniteNumber(face?.aId, 0),
            bId: this.toFiniteNumber(face?.bId, 0),
            cId: this.toFiniteNumber(face?.cId, 0)
        })) : [];
        this.presetFaces3D = Array.isArray(state.presetFaces3D) ? state.presetFaces3D.map(face => ({
            aId: this.toFiniteNumber(face?.aId, 0),
            bId: this.toFiniteNumber(face?.bId, 0),
            cId: this.toFiniteNumber(face?.cId, 0)
        })) : [];

        this.presetEdgeMeshes2D = [];
        this.presetEdgeMeshes3D = [];
        this.presetFaceMeshes2D = [];
        this.presetFaceMeshes3D = [];

        this.usedMatrixLetters2D = new Set(Array.isArray(state.usedMatrixLetters2D)
            ? state.usedMatrixLetters2D
            : this.matrices2D.map(matrix => matrix.name).filter(Boolean));
        this.usedMatrixLetters3D = new Set(Array.isArray(state.usedMatrixLetters3D)
            ? state.usedMatrixLetters3D
            : this.matrices3D.map(matrix => matrix.name).filter(Boolean));

        this.selectedMatrixId2D = state.selectedMatrixId2D ?? (this.matrices2D[0]?.id ?? null);
        this.selectedMatrixId3D = state.selectedMatrixId3D ?? (this.matrices3D[0]?.id ?? null);
        this.colorIndex2D = this.toFiniteNumber(state.colorIndex2D, 0);
        this.colorIndex3D = this.toFiniteNumber(state.colorIndex3D, 0);

        this.cameraState2D = this.deserializeCameraState(state.cameraState2D);
        this.cameraState3D = this.deserializeCameraState(state.cameraState3D);

        this.vectors = this.vectors2D;
        this.matrices = this.matrices2D;
        this.lines = this.lines2D;
        this.planes = this.planes3D;
        this.presetEdges = this.presetEdges2D;
        this.presetEdgeMeshes = this.presetEdgeMeshes2D;
        this.presetFaces = this.presetFaces2D;
        this.presetFaceMeshes = this.presetFaceMeshes2D;
        this.usedMatrixLetters = this.usedMatrixLetters2D;
        this.selectedMatrixId = this.selectedMatrixId2D;
        this.colorIndex = this.colorIndex2D;

        const counters = state.counters || {};
        const maxVectorId = Math.max(0, ...this.vectors2D.map(v => v.id), ...this.vectors3D.map(v => v.id));
        const maxMatrixId = Math.max(0, ...this.matrices2D.map(m => m.id), ...this.matrices3D.map(m => m.id));
        const maxLineId = Math.max(0, ...this.lines2D.map(l => l.id), ...this.lines3D.map(l => l.id));
        const maxPlaneId = Math.max(0, ...this.planes3D.map(p => p.id));

        this.nextVectorId = Math.max(this.toFiniteNumber(counters.nextVectorId, 1), maxVectorId + 1);
        this.nextMatrixId = Math.max(this.toFiniteNumber(counters.nextMatrixId, 1), maxMatrixId + 1);
        this.nextLineId = Math.max(this.toFiniteNumber(counters.nextLineId, 1), maxLineId + 1);
        this.nextPlaneId = Math.max(this.toFiniteNumber(counters.nextPlaneId, 1), maxPlaneId + 1);

        this.updateVectorDisplayModeUI();
        this.updateVectorSizeModeUI();
        this.updateInfoPanelsSizeModeUI();
        this.updateGridToggleUI();
        this.updateIntersectionsToggleUI();
        this.updatePlaneExtentControl();

        const targetDimension = this.normalizeDimension(state.dimension);
        this.switchDimension(targetDimension, { skipCameraStateCapture: true, skipStateSave: true });
        this.updateObjectsList();
        this.updateIntersections();

        return true;
    }

    updateGridToggleUI() {
        const gridToggleButton = document.getElementById('grid-toggle-btn');
        const gridIcon = document.getElementById('grid-icon');
        if (!gridToggleButton) return;

        gridToggleButton.style.background = this.gridVisible ? '#2A3F5A' : '#1a2a3f';
        gridToggleButton.style.opacity = this.gridVisible ? '1' : '0.6';
        gridToggleButton.title = this.gridVisible
            ? 'Grid + Axis Labels enabled (click to disable)'
            : 'Grid + Axis Labels disabled (click to enable)';

        if (gridIcon) {
            if (this.gridVisible) {
                gridIcon.classList.add('grid-active');
            } else {
                gridIcon.classList.remove('grid-active');
            }
        }
    }

    updateIntersectionsToggleUI() {
        const intersectionToggleButton = document.getElementById('intersection-toggle-btn');
        const intersectionIcon = document.getElementById('intersection-icon');
        if (!intersectionToggleButton) return;

        intersectionToggleButton.style.background = this.intersectionsVisible ? '#2A3F5A' : '#1a2a3f';
        intersectionToggleButton.style.opacity = this.intersectionsVisible ? '1' : '0.6';
        intersectionToggleButton.title = this.intersectionsVisible
            ? 'Intersections enabled (click to disable)'
            : 'Intersections disabled (click to enable)';

        if (intersectionIcon) {
            if (this.intersectionsVisible) {
                intersectionIcon.classList.add('intersection-active');
            } else {
                intersectionIcon.classList.remove('intersection-active');
            }
        }
    }

    updatePlaneExtentControl() {
        const control = document.getElementById('plane-extent-control');
        const slider = document.getElementById('plane-extent-slider');
        const valueLabel = document.getElementById('plane-extent-value');
        if (!control || !slider || !valueLabel) return;

        const hasVisiblePlane = this.dimension === '3d' && this.planes.some(plane => plane.visible);
        control.style.display = hasVisiblePlane ? 'block' : 'none';

        const clampedExtent = Math.max(5, Math.min(100, this.toFiniteNumber(this.planeExtent, 10)));
        this.planeExtent = clampedExtent;
        slider.value = String(clampedExtent);
        valueLabel.textContent = String(clampedExtent);
    }

    updateVectorDisplayModeUI() {
        const vecArrow = document.getElementById('vec-arrow');
        const vecPoint = document.getElementById('vec-point');
        if (!vecArrow || !vecPoint) return;

        vecArrow.classList.remove('vec-active');
        vecPoint.classList.remove('vec-active');

        if (this.vectorDisplayMode === 'vectors') {
            vecArrow.classList.add('vec-active');
        } else {
            vecPoint.classList.add('vec-active');
        }
    }

    switchDimension(dimension, options = {}) {
        const {
            skipCameraStateCapture = false,
            skipStateSave = false
        } = options;

        // Save old dimension before changing
        const oldDimension = this.dimension;
        if (!skipCameraStateCapture) {
            this.captureCurrentCameraState();
        }
        
        this.dimension = dimension;
        this.isResizing = true; // Prevent animation loop from interfering

        // Update dimension button label
        const dim2d = document.getElementById('dim-2d');
        const dim3d = document.getElementById('dim-3d');
        if (dim2d && dim3d) {
            if (dimension === '2d') {
                dim2d.classList.add('dim-active');
                dim3d.classList.remove('dim-active');
            } else {
                dim3d.classList.add('dim-active');
                dim2d.classList.remove('dim-active');
            }
        }
        
        // Update dropdown visibility for dimension-specific items
        this.updateDropdownVisibility();

        // Update camera and controls
        if (dimension === '2d') {
            // Lock camera to front view for 2D mode (looking at XY plane)
            this.camera.position.set(0, 0, 10);
            this.camera.lookAt(0, 0, 0);
            this.controls.enableRotate = false; // Disable rotation in 2D
            this.controls.target.set(0, 0, 0);
            
            // Set mouse buttons for 2D: left = pan, right for vectors
            this.controls.mouseButtons = {
                LEFT: THREE.MOUSE.PAN,
                MIDDLE: THREE.MOUSE.DOLLY
            };
            
            // Set touch controls for 2D: one finger = pan, pinch = zoom
            this.controls.touches = {
                ONE: THREE.TOUCH.PAN,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
        } else {
            // Enable full 3D camera control
            this.camera.position.set(3, 3, 3);
            this.camera.lookAt(0, 0, 0);
            this.controls.enableRotate = true; // Enable rotation in 3D
            this.controls.target.set(0, 0, 0);
            
            // Set mouse buttons for 3D: left = rotate, right = pan
            this.controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            
            // Set touch controls for 3D: one finger = rotate, two fingers = pan, pinch = zoom
            this.controls.touches = {
                ONE: THREE.TOUCH.ROTATE,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
        }

        const savedCameraState = this.getCameraStateForDimension(dimension);
        if (savedCameraState) {
            this.applyCameraState(savedCameraState);
        } else {
            this.controls.update();
        }
        
        // Recalculate axis lengths for the new camera position and dimension
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        const visibleHeight = 2 * distanceToTarget * Math.tan(fov / 2);
        const visibleWidth = visibleHeight * aspect;
        
        if (this.dimension === '2d') {
            this.axisLengthX = visibleWidth * 2.0;
            this.axisLengthY = visibleHeight * 2.0;
            this.axisLengthZ = Math.min(visibleWidth, visibleHeight) * 2.0;
        } else {
            const minDim = Math.min(visibleWidth, visibleHeight);
            this.axisLengthX = minDim;
            this.axisLengthY = minDim;
            this.axisLengthZ = minDim;
        }
        
        this.createGrid(); // Recreate grid with proper orientation
        this.createAxes(); // Recreate axes with proper visibility
        
        // Allow animation loop to resume after a brief delay
        setTimeout(() => {
            this.isResizing = false;
        }, 100);
        
        // Clean up temp arrow if exists
        if (this.tempArrow) {
            this.scene.remove(this.tempArrow);
            this.tempArrow = null;
        }
        this.isDragging = false;
        this.controls.enabled = true;
        
        // Save current dimension's state before switching
        if (oldDimension === '2d') {
            this.vectors2D = this.vectors;
            this.matrices2D = this.matrices;
            this.lines2D = this.lines;
            this.presetEdges2D = this.presetEdges;
            this.presetEdgeMeshes2D = this.presetEdgeMeshes;
            this.presetFaces2D = this.presetFaces;
            this.presetFaceMeshes2D = this.presetFaceMeshes;
            this.usedMatrixLetters2D = this.usedMatrixLetters;
            this.selectedMatrixId2D = this.selectedMatrixId;
            this.colorIndex2D = this.colorIndex;
        } else {
            this.vectors3D = this.vectors;
            this.matrices3D = this.matrices;
            this.lines3D = this.lines;
            this.planes3D = this.planes;
            this.presetEdges3D = this.presetEdges;
            this.presetEdgeMeshes3D = this.presetEdgeMeshes;
            this.presetFaces3D = this.presetFaces;
            this.presetFaceMeshes3D = this.presetFaceMeshes;
            this.usedMatrixLetters3D = this.usedMatrixLetters;
            this.selectedMatrixId3D = this.selectedMatrixId;
            this.colorIndex3D = this.colorIndex;
        }
        
        // Clear current visualizations from scene
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
            if (vec.labelSprite) this.scene.remove(vec.labelSprite);
        });
        this.lines.forEach(line => {
            if (line.mesh) this.scene.remove(line.mesh);
        });
        this.planes.forEach(plane => {
            if (plane.mesh) this.scene.remove(plane.mesh);
        });
        this.presetFaceMeshes.forEach(face => this.scene.remove(face));
        this.presetFaceMeshes.length = 0;
        this.presetEdgeMeshes.forEach(line => this.scene.remove(line));
        this.presetEdgeMeshes.length = 0;
        
        // Swap to the new dimension's data
        if (dimension === '2d') {
            this.vectors = this.vectors2D;
            this.matrices = this.matrices2D;
            this.lines = this.lines2D;
            this.planes = []; // No planes in 2D
            this.presetEdges = this.presetEdges2D;
            this.presetEdgeMeshes = this.presetEdgeMeshes2D;
            this.presetFaces = this.presetFaces2D;
            this.presetFaceMeshes = this.presetFaceMeshes2D;
            this.usedMatrixLetters = this.usedMatrixLetters2D;
            this.selectedMatrixId = this.selectedMatrixId2D;
            this.colorIndex = this.colorIndex2D;
        } else {
            this.vectors = this.vectors3D;
            this.matrices = this.matrices3D;
            this.lines = this.lines3D;
            this.planes = this.planes3D;
            this.presetEdges = this.presetEdges3D;
            this.presetEdgeMeshes = this.presetEdgeMeshes3D;
            this.presetFaces = this.presetFaces3D;
            this.presetFaceMeshes = this.presetFaceMeshes3D;
            this.usedMatrixLetters = this.usedMatrixLetters3D;
            this.selectedMatrixId = this.selectedMatrixId3D;
            this.colorIndex = this.colorIndex3D;
        }
        
        // Ensure all vectors have their THREE.js objects created
        this.vectors.forEach(vec => {
            if (!vec.arrow || !vec.pointSphere) {
                const x = vec.originalEnd.x;
                const y = vec.originalEnd.y;
                const z = vec.originalEnd.z;
                
                const origin = new THREE.Vector3(0, 0, 0);
                const direction = new THREE.Vector3(x, y, z).normalize();
                const length = Math.sqrt(x * x + y * y + z * z);
                
                const thickness = this.getVectorArrowThickness();
                vec.arrow = this.createSmoothArrow(
                    direction,
                    origin,
                    length,
                    vec.color,
                    thickness.headLength,
                    thickness.headWidth
                );
                
                // Create point marker (sprite in 2D, sphere in 3D)
                vec.pointSphere = this.createVectorPointVisual(vec.color, new THREE.Vector3(x, y, z));
            }
        });
        
        // Re-render lines and planes
        this.lines.forEach(line => this.renderLine(line));
        this.planes.forEach(plane => this.renderPlane(plane));
        
        // Update vector visualization for new dimension
        this.updateVectorDisplay();
        
        // Update objects list
        this.updateObjectsList();
        
        // Reset eigenvalue panel and invariant spaces when switching dimensions
        this.eigenvaluePanelMatrixId = null;
        this.invariantDisplayMode = 'off';
        this.clearInvariantSpaces();
        this.visualizeInvariantSpaces();
        this.updateEigenvaluePanel();
        this.updateIntersections();
        this.angleVisualizationState = null;
        this.clearAngleVisualization();
        this.captureCurrentCameraState();
        if (!skipStateSave) {
            this.scheduleStateSave();
        }
    }

    resetView() {
        const targetPosition = this.dimension === '2d'
            ? new THREE.Vector3(0, 0, 10)
            : new THREE.Vector3(3, 3, 3);
        const targetLookAt = new THREE.Vector3(0, 0, 0);

        const lookAtObject = new THREE.Object3D();
        lookAtObject.position.copy(targetPosition);
        lookAtObject.up.copy(this.camera.up);
        lookAtObject.lookAt(targetLookAt);

        this.viewResetAnimation = {
            startTime: performance.now(),
            durationMs: 600,
            startPosition: this.camera.position.clone(),
            endPosition: targetPosition,
            startTarget: this.controls.target.clone(),
            endTarget: targetLookAt,
            startQuaternion: this.camera.quaternion.clone(),
            endQuaternion: lookAtObject.quaternion.clone()
        };
    }

    zoomCamera(factor) {
        // Zoom camera by adjusting distance to target
        // factor < 1 zooms in (closer), factor > 1 zooms out (farther)
        
        const direction = new THREE.Vector3();
        direction.subVectors(this.camera.position, this.controls.target);
        
        const currentDistance = direction.length();
        const newDistance = currentDistance * factor;
        
        // Clamp to min/max distance limits
        const clampedDistance = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, newDistance));
        
        // Move camera to new distance
        direction.normalize();
        this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(clampedDistance));
        
        this.controls.update();
    }

    panCamera(x, y, z) {
        // Pan camera and target by the given amounts
        // Uses camera's local coordinate system for natural panning
        
        const offset = new THREE.Vector3();
        
        // Get camera's right vector (local X axis)
        const right = new THREE.Vector3();
        right.setFromMatrixColumn(this.camera.matrix, 0);
        
        // Get camera's up vector (local Y axis)
        const up = new THREE.Vector3();
        up.setFromMatrixColumn(this.camera.matrix, 1);
        
        // Calculate offset in camera space
        offset.add(right.multiplyScalar(x));
        offset.add(up.multiplyScalar(y));
        
        // Move both camera and target by the same offset
        this.camera.position.add(offset);
        this.controls.target.add(offset);
        
        this.controls.update();
    }

    toggleGrid() {
        this.gridVisible = !this.gridVisible;
        
        if (this.gridHelper) {
            this.gridHelper.visible = this.gridVisible;
        }

        if (this.axisNumbers) {
            this.axisNumbers.visible = this.gridVisible;
        }
        
        this.updateGridToggleUI();
        this.scheduleStateSave();
    }

    toggleIntersections() {
        this.intersectionsVisible = !this.intersectionsVisible;

        if (this.intersectionsVisible) {
            this.updateIntersections();
        } else {
            this.clearIntersections();
            this.updateVectorPanel();
            this.updateLinePanel();
            this.updatePlanePanel();
            this.updateAngleVisualization();
        }

        this.updateIntersectionsToggleUI();
        this.scheduleStateSave();
    }
    
    toggleDimension() {
        // Toggle between 2D and 3D
        const newDimension = this.dimension === '2d' ? '3d' : '2d';
        this.switchDimension(newDimension);
    }

    toggleVectorDisplayMode() {
        // Cycle through: vectors -> points -> vectors
        const modes = ['vectors', 'points'];
        const currentIndex = modes.indexOf(this.vectorDisplayMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.vectorDisplayMode = modes[nextIndex];
        
        this.updateVectorDisplayModeUI();
        
        // Update vector visualization
        this.updateVectorDisplay();
        this.scheduleStateSave();
    }

    toggleVectorSizeMode() {
        this.vectorSizeMode = this.vectorSizeMode === 'small' ? 'large' : 'small';
        this.updateVectorSizeModeUI();
        this.updateInfoPanelsSizeModeUI();
        this.updateVectorThickness(true);
        this.updateInvariantLineThickness();
        this.updatePointSphereScales();
        this.updateNumberLabelScales();
        this.scheduleStateSave();
    }

    updateVectorSizeModeUI() {
        const sizeSmall = document.getElementById('size-small');
        const sizeLarge = document.getElementById('size-large');
        if (!sizeSmall || !sizeLarge) return;

        sizeSmall.classList.remove('size-active');
        sizeLarge.classList.remove('size-active');

        if (this.vectorSizeMode === 'small') {
            sizeSmall.classList.add('size-active');
        } else {
            sizeLarge.classList.add('size-active');
        }
    }

    updateInfoPanelsSizeModeUI() {
        const infoPanelIds = ['eigenvalue-panel', 'line-info-panel', 'plane-info-panel', 'vector-info-panel'];
        const isMobileOrTablet = this.deviceInfo && (this.deviceInfo.isMobilePhone || this.deviceInfo.isTablet);
        const useLargePanels = this.vectorSizeMode === 'large' && !isMobileOrTablet;

        infoPanelIds.forEach(id => {
            const panel = document.getElementById(id);
            if (!panel) return;

            if (useLargePanels) {
                panel.classList.add('info-panel-large');
            } else {
                panel.classList.remove('info-panel-large');
            }
        });
    }

    getTransformationMatrix(matrixId = null) {
        // Use the provided matrix ID, or fall back to selected matrix
        const targetId = matrixId || this.selectedMatrixId;
        
        if (!targetId) {
            // Return identity matrix
            if (this.dimension === '2d') {
                return new THREE.Matrix3().set(
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                );
            } else {
                return new THREE.Matrix3().set(
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                );
            }
        }
        
        const matrix = this.matrices.find(m => m.id === targetId);
        if (!matrix) {
            // Return identity if matrix not found
            if (this.dimension === '2d') {
                return new THREE.Matrix3().set(
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                );
            } else {
                return new THREE.Matrix3().set(
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                );
            }
        }
        
        // Create THREE.Matrix3 from our stored matrix values
        if (this.dimension === '2d') {
            return new THREE.Matrix3().set(
                matrix.values[0][0], matrix.values[0][1], 0,
                matrix.values[1][0], matrix.values[1][1], 0,
                0, 0, 1
            );
        } else {
            return new THREE.Matrix3().set(
                matrix.values[0][0], matrix.values[0][1], matrix.values[0][2],
                matrix.values[1][0], matrix.values[1][1], matrix.values[1][2],
                matrix.values[2][0], matrix.values[2][1], matrix.values[2][2]
            );
        }
    }

    onCanvasMouseDown(event) {
        if (this.isAnimating) return;
        
        // Vector creation: right-click in 2D, middle-click in 3D
        const isVectorButton = (this.dimension === '2d' && event.button === 2) || 
                               (this.dimension === '3d' && event.button === 1);
        
        if (!isVectorButton) return;
        
        // Prevent default behavior
        event.preventDefault();

        this.isDragging = true;
        this.controls.enabled = false; // Disable orbit controls while drawing
        
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    onCanvasMouseMove(event) {
        if (!this.isDragging || this.isAnimating) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Create a plane to intersect with based on mode
        let plane, intersectPoint = new THREE.Vector3();
        
        if (this.dimension === '2d') {
            // XY plane (z = 0) for 2D mode
            plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            if (intersectPoint) {
                // Snap to grid for preview
                const x = Math.round(intersectPoint.x / this.currentGridSpacing) * this.currentGridSpacing;
                const y = Math.round(intersectPoint.y / this.currentGridSpacing) * this.currentGridSpacing;
                this.updateTempVector(x, y, 0);
            }
        } else {
            // XZ plane (y = 0) for 3D mode
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            if (intersectPoint) {
                // Snap to grid for preview
                const x = Math.round(intersectPoint.x / this.currentGridSpacing) * this.currentGridSpacing;
                const y = Math.round(intersectPoint.y / this.currentGridSpacing) * this.currentGridSpacing;
                const z = Math.round(intersectPoint.z / this.currentGridSpacing) * this.currentGridSpacing;
                this.updateTempVector(x, y, z);
            }
        }
    }

    onCanvasMouseUp(event) {
        if (!this.isDragging || this.isAnimating) return;

        this.isDragging = false;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Create a plane to intersect with based on mode
        let plane, intersectPoint = new THREE.Vector3();
        
        if (this.dimension === '2d') {
            // XY plane (z = 0) for 2D mode
            plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            if (intersectPoint) {
                // Snap to grid intersection
                const x = Math.round(intersectPoint.x / this.currentGridSpacing) * this.currentGridSpacing;
                const y = Math.round(intersectPoint.y / this.currentGridSpacing) * this.currentGridSpacing;
                
                // Only add if vector has some length
                if (x !== 0 || y !== 0) {
                    this.addVector(x, y, 0);
                }
            }
        } else {
            // XZ plane (y = 0) for 3D mode
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            if (intersectPoint) {
                // Snap to grid intersection
                const x = Math.round(intersectPoint.x / this.currentGridSpacing) * this.currentGridSpacing;
                const y = Math.round(intersectPoint.y / this.currentGridSpacing) * this.currentGridSpacing;
                const z = Math.round(intersectPoint.z / this.currentGridSpacing) * this.currentGridSpacing;
                
                // Only add if vector has some length
                if (x !== 0 || y !== 0 || z !== 0) {
                    this.addVector(x, y, z);
                }
            }
        }

        // Remove temp arrow
        if (this.tempArrow) {
            this.scene.remove(this.tempArrow);
            this.tempArrow = null;
        }
        
        // Re-enable orbit controls
        this.controls.enabled = true;
    }

    updateTempVector(x, y, z) {
        // Remove old temp arrow if exists
        if (this.tempArrow) {
            this.scene.remove(this.tempArrow);
        }

        const origin = new THREE.Vector3(0, 0, 0);
        const direction = new THREE.Vector3(x, y, z).normalize();
        const length = Math.sqrt(x * x + y * y + z * z);

        if (length > 0.1) { // Only show if dragged far enough
            // Semi-transparent preview color
            const color = 0x888888;
            
            const thickness = this.getVectorArrowThickness();
            this.tempArrow = this.createSmoothArrow(
                direction,
                origin,
                length,
                color,
                thickness.headLength,
                thickness.headWidth
            );
            
            // Make temp arrow semi-transparent
            this.tempArrow.traverse((child) => {
                if (child.material) {
                    child.material.transparent = true;
                    child.material.opacity = 0.5;
                }
            });
            
            this.scene.add(this.tempArrow);
        }
    }

    addVector(x, y, z = 0) {
        const origin = new THREE.Vector3(0, 0, 0);
        const direction = new THREE.Vector3(x, y, z).normalize();
        const length = Math.sqrt(x * x + y * y + z * z);
        
        // Use next color from graphiti's color palette
        const colorHex = this.vectorColors[this.colorIndex % this.vectorColors.length];
        this.colorIndex++;
        const color = new THREE.Color(colorHex);
        
        const thickness = this.getVectorArrowThickness();
        const arrow = this.createSmoothArrow(
            direction,
            origin,
            length,
            color,
            thickness.headLength,
            thickness.headWidth
        );

        // Create point marker for points mode (sprite in 2D, sphere in 3D)
        const pointSphere = this.createVectorPointVisual(color, new THREE.Vector3(x, y, z));

        const vectorId = this.nextVectorId++;
        const vectorName = this.getNextIndexedName('V', this.vectors);

        const vector = {
            arrow: arrow,
            pointSphere: pointSphere,
            name: vectorName,
            originalEnd: new THREE.Vector3(x, y, z),
            currentEnd: new THREE.Vector3(x, y, z),
            color: color,
            id: vectorId,
            visible: true
        };

        this.vectors.push(vector);
        
        // Expand vectors group so user can see it was added
        this.groupCollapsed.vectors = false;
        
        // Add appropriate visualization based on current mode
        this.updateVectorDisplay();
        this.updatePointSphereScales();
        this.updateObjectsList();
        this.scheduleStateSave();

        return vector;
    }

    updateVectorList() {
        this.updateObjectsList();
    }
    
    updateVectorDisplay() {
        // Remove all current visualizations
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
            if (vec.labelSprite) this.scene.remove(vec.labelSprite);
        });

        // Clear preset face meshes
        this.presetFaceMeshes.forEach(face => this.scene.remove(face));
        this.presetFaceMeshes.length = 0;
        
        // Clear preset edge meshes
        this.presetEdgeMeshes.forEach(line => this.scene.remove(line));
        this.presetEdgeMeshes.length = 0;
        
        // Add appropriate visualizations based on mode
        if (this.vectorDisplayMode === 'vectors') {
            // Show arrows for visible vectors
            this.vectors.forEach(vec => {
                if (vec.visible && vec.arrow) {
                    this.scene.add(vec.arrow);
                }
            });
        } else if (this.vectorDisplayMode === 'points') {
            // Show points for visible vectors
            this.vectors.forEach(vec => {
                if (vec.visible && vec.pointSphere) {
                    vec.pointSphere.renderOrder = 1004;
                    vec.pointSphere.material.depthTest = false;
                    vec.pointSphere.material.depthWrite = false;
                    this.scene.add(vec.pointSphere);
                }
            });
        }

        this.renderPresetFaces();
        this.renderPresetEdges();
    }

    toSubscriptNumber(number) {
        const map = {
            '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
            '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
            '-': '₋'
        };
        return String(number).split('').map(char => map[char] || char).join('');
    }

    formatIndexedLabelWithSubscript(label) {
        if (!label) return '';
        const match = String(label).match(/^([A-Za-z]+)(\d+)$/);
        if (!match) return String(label);
        return `${match[1]}${this.toSubscriptNumber(match[2])}`;
    }

    formatDisplayNumber(value, maxDecimals = 3) {
        if (!Number.isFinite(value)) return String(value);
        if (Math.abs(value) < 1e-10) return '0';
        const rounded = Number(value.toFixed(maxDecimals));
        return Object.is(rounded, -0) ? '0' : String(rounded);
    }

    formatDisplayAngle(radians, maxDecimals = 1) {
        const degrees = radians * (180 / Math.PI);
        return `${this.formatDisplayNumber(degrees, maxDecimals)}°`;
    }

    formatVectorComponents(vector3) {
        const components = this.dimension === '3d'
            ? [vector3.x, vector3.y, vector3.z]
            : [vector3.x, vector3.y];
        return `(${components.map(value => this.formatDisplayNumber(value, 3)).join(', ')})`;
    }

    calculateVectorAngle(vector1, vector2) {
        const v1 = this.getVectorPointVector(vector1);
        const v2 = this.getVectorPointVector(vector2);
        const mag1 = v1.length();
        const mag2 = v2.length();
        if (mag1 < 1e-10 || mag2 < 1e-10) return null;
        const dot = v1.dot(v2) / (mag1 * mag2);
        return Math.acos(Math.min(1, Math.max(-1, dot)));
    }

    createVectorLabelSprite(vectorId) {
        const labelText = `V${vectorId}`;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');

        if (!context) return null;

        context.clearRect(0, 0, canvas.width, canvas.height);

        const currentTheme = document.documentElement.getAttribute('data-theme');
        const isLight = currentTheme === 'light';
        const textColor = isLight ? '#222222' : '#FFFFFF';
        const outlineColor = isLight ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';

        context.font = 'bold 48px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.lineWidth = 8;
        context.strokeStyle = outlineColor;
        context.strokeText(labelText, canvas.width / 2, canvas.height / 2);
        context.fillStyle = textColor;
        context.fillText(labelText, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 1005;
        return sprite;
    }

    updateVectorLabelTransforms() {
        this.vectors.forEach(vec => {
            if (!vec.labelSprite) return;
            if (!vec.visible) {
                this.scene.remove(vec.labelSprite);
                return;
            }

            const tip = vec.currentEnd.clone();
            const distanceToCamera = Math.max(0.01, this.camera.position.distanceTo(tip));
            const labelScale = distanceToCamera * 0.08;
            const direction = tip.clone().normalize();
            const hasDirection = direction.lengthSq() > 1e-10;
            const alongVectorOffset = hasDirection ? direction.multiplyScalar(labelScale * 0.25) : new THREE.Vector3(0, 0, 0);

            // Small camera-facing offset to keep label clear of arrowhead/sphere
            const toCamera = this.camera.position.clone().sub(tip);
            let cameraOffset = new THREE.Vector3();
            if (toCamera.lengthSq() > 1e-10) {
                cameraOffset = toCamera.normalize().multiplyScalar(labelScale * 0.15);
            }

            vec.labelSprite.position.copy(tip.clone().add(alongVectorOffset).add(cameraOffset));
            vec.labelSprite.scale.set(labelScale * 1.4, labelScale * 0.7, 1);
        });
    }

    disposeVectorLabel(vec) {
        if (!vec.labelSprite) return;

        this.scene.remove(vec.labelSprite);
        if (vec.labelSprite.material) {
            if (vec.labelSprite.material.map) {
                vec.labelSprite.material.map.dispose();
            }
            vec.labelSprite.material.dispose();
        }
        vec.labelSprite = null;
    }

    renderPresetFaces() {
        if (this.dimension !== '3d') return;
        if (this.presetFaces.length === 0) return;

        const faceStyle = this.getPresetFaceStyle();

        this.presetFaces.forEach(face => {
            const aVec = this.vectors.find(v => v.id === face.aId);
            const bVec = this.vectors.find(v => v.id === face.bId);
            const cVec = this.vectors.find(v => v.id === face.cId);

            if (!aVec || !bVec || !cVec) return;
            if (!aVec.visible || !bVec.visible || !cVec.visible) return;

            const positions = new Float32Array([
                aVec.currentEnd.x, aVec.currentEnd.y, aVec.currentEnd.z,
                bVec.currentEnd.x, bVec.currentEnd.y, bVec.currentEnd.z,
                cVec.currentEnd.x, cVec.currentEnd.y, cVec.currentEnd.z
            ]);

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.computeVertexNormals();

            const material = new THREE.MeshBasicMaterial({
                color: faceStyle.color,
                transparent: true,
                opacity: faceStyle.opacity,
                side: THREE.DoubleSide,
                depthWrite: false,
                depthTest: true,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2
            });

            const triangle = new THREE.Mesh(geometry, material);
            triangle.renderOrder = 1;
            this.presetFaceMeshes.push(triangle);
            this.scene.add(triangle);
        });
    }

    renderPresetEdges() {
        if (this.presetEdges.length === 0) return;

        const thickness = this.getVectorArrowThickness();
        const lineRadius = thickness.headWidth * 0.18;
        const radialSegments = this.dimension === '2d' ? 3 : 16;
        const edgeColor = this.getPresetEdgeColor();
        const isSmallMode = this.vectorSizeMode === 'small';
        const useOverlayEdges = this.dimension === '2d' && isSmallMode;

        this.presetEdges.forEach(edge => {
            const startVec = this.vectors.find(v => v.id === edge.startId);
            const endVec = this.vectors.find(v => v.id === edge.endId);

            if (!startVec || !endVec) return;
            if (!startVec.visible || !endVec.visible) return;

            const start = startVec.currentEnd.clone();
            const end = endVec.currentEnd.clone();
            const direction = new THREE.Vector3().subVectors(end, start);
            const length = direction.length();

            if (length === 0) return;

            direction.normalize();

            const geometry = new THREE.CylinderGeometry(
                lineRadius,
                lineRadius,
                length,
                radialSegments,
                1,
                false
            );

            const material = new THREE.MeshBasicMaterial({
                color: edgeColor,
                depthWrite: !useOverlayEdges,
                depthTest: !useOverlayEdges,
                polygonOffset: true,
                polygonOffsetFactor: useOverlayEdges ? -6 : -4,
                polygonOffsetUnits: useOverlayEdges ? -6 : -4
            });

            if (this.dimension === '3d') {
                material.polygonOffset = false;
                material.polygonOffsetFactor = 0;
                material.polygonOffsetUnits = 0;
            }

            const cylinder = new THREE.Mesh(geometry, material);
            cylinder.renderOrder = useOverlayEdges ? 1003 : 2;

            const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
            cylinder.position.copy(midpoint);

            const axis = new THREE.Vector3(0, 1, 0);
            const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
            cylinder.quaternion.copy(quaternion);

            this.presetEdgeMeshes.push(cylinder);
            this.scene.add(cylinder);
        });
    }

    getPresetEdgeColor() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        return currentTheme === 'light' ? 0x000000 : 0xffffff;
    }

    getPresetFaceStyle() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme === 'light') {
            return { color: 0x000000, opacity: 0.07 };
        }
        return { color: 0xffffff, opacity: 0.11 };
    }

    clearPresetEdges() {
        this.presetFaceMeshes.forEach(face => this.scene.remove(face));
        this.presetFaceMeshes.length = 0;
        this.presetFaces.length = 0;
        this.presetEdgeMeshes.forEach(line => this.scene.remove(line));
        this.presetEdgeMeshes.length = 0;
        this.presetEdges.length = 0;
    }
    
    updateObjectsList() {
        const container = document.getElementById('objects-container');
        container.innerHTML = '';

        // Always render Matrices group
        this.renderCollapsibleGroup(container, 'matrices', 'Matrices', this.matrices, this.renderMatrixItem);

        // Always render Planes group in 3D mode
        if (this.dimension === '3d') {
            this.renderCollapsibleGroup(container, 'planes', 'Planes', this.planes, this.renderPlaneItem);
        }

        // Always render Lines group
        this.renderCollapsibleGroup(container, 'lines', 'Lines', this.lines, this.renderLineItem);

        // Always render Vectors group
        this.renderCollapsibleGroup(container, 'vectors', 'Vectors', this.vectors, this.renderVectorItem);
        
        // Update info panels if they're open
        this.updateVectorPanel();
        this.updateLinePanel();
        this.updatePlanePanel();
        this.updateAngleVisualization();
        this.updatePlaneExtentControl();
    }
    
    renderCollapsibleGroup(container, groupKey, groupName, items, renderFunction) {
        // Create group container
        const groupContainer = document.createElement('div');
        groupContainer.className = 'object-group';
        
        // Create group header
        const header = document.createElement('div');
        header.className = 'object-group-header';
        const isCollapsed = this.groupCollapsed[groupKey];
        
        // Arrow indicator
        const arrow = document.createElement('span');
        arrow.className = 'group-arrow';
        arrow.textContent = isCollapsed ? '▶\uFE0E' : '▼\uFE0E'; // \uFE0E forces text rendering on iOS
        
        // Group label with count
        const label = document.createElement('span');
        label.className = 'group-label';
        label.textContent = `${groupName} (${items.length})`;
        
        // Add button for quick item creation
        const addBtn = document.createElement('button');
        addBtn.className = 'group-add-btn';
        addBtn.innerHTML = '<svg class="group-add-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><line x1="5" y1="1.5" x2="5" y2="8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line><line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></line></svg>';
        addBtn.title = `Add ${groupName.slice(0, -1)}`; // Remove 's' from plural
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent header click (collapse/expand)
            
            // Call appropriate add function based on group key
            switch(groupKey) {
                case 'matrices':
                    this.addMatrix();
                    break;
                case 'vectors':
                    this.addVector(1, 0, 0); // Default vector
                    break;
                case 'lines':
                    this.addLine();
                    break;
                case 'planes':
                    this.addPlane();
                    break;
            }
        });
        
        header.appendChild(arrow);
        header.appendChild(label);
        header.appendChild(addBtn);
        
        // Create items container (always render for animation)
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'object-group-items';
        if (isCollapsed) {
            itemsContainer.classList.add('collapsed');
        }
        
        items.forEach(item => {
            renderFunction.call(this, itemsContainer, item);
        });
        
        // Click handler to toggle collapse
        header.addEventListener('click', () => {
            this.groupCollapsed[groupKey] = !this.groupCollapsed[groupKey];
            const nowCollapsed = this.groupCollapsed[groupKey];
            
            // Toggle collapsed class for animation
            if (nowCollapsed) {
                itemsContainer.classList.add('collapsed');
                arrow.textContent = '▶\uFE0E';
            } else {
                itemsContainer.classList.remove('collapsed');
                arrow.textContent = '▼\uFE0E';
            }
            
            // Update count in label (in case items changed)
            label.textContent = `${groupName} (${items.length})`;
            this.scheduleStateSave();
        });
        
        groupContainer.appendChild(header);
        groupContainer.appendChild(itemsContainer);
        
        container.appendChild(groupContainer);
    }
    
    renderMatrixItem(container, matrix) {
        const item = document.createElement('div');
        item.className = 'matrix-item';
        item.style.borderLeftColor = matrix.color.getStyle();
        item.setAttribute('data-matrix-id', matrix.id);

        const mainRow = document.createElement('div');
        mainRow.className = 'matrix-main-row';
        
        // Matrix content (name + grid)
        const matrixContent = document.createElement('div');
        matrixContent.className = 'matrix-content';
        
        const nameSpan = document.createElement('div');
        nameSpan.className = 'matrix-name';
        // Hide '=' sign on mobile touch devices (phones and tablets), including iPad
        const isMobileTouchDevice = Boolean(this.deviceInfo && (this.deviceInfo.isMobilePhone || this.deviceInfo.isTablet));
        nameSpan.textContent = isMobileTouchDevice ? matrix.name : matrix.name + ' =';
        matrixContent.appendChild(nameSpan);
        
        // Matrix grid with brackets
        const gridContainer = document.createElement('div');
        gridContainer.className = 'matrix-grid-container';
        
        const leftBracket = document.createElement('span');
        leftBracket.className = 'matrix-bracket';
        leftBracket.textContent = '[';
        gridContainer.appendChild(leftBracket);
        
        const grid = document.createElement('div');
        grid.className = `matrix-grid ${this.dimension === '2d' ? 'matrix-2x2' : 'matrix-3x3'}`;
        
        const size = this.dimension === '2d' ? 2 : 3;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                const input = document.createElement('input');
                input.type = 'number';
                input.step = '0.1';
                const val = matrix.values[row][col];
                input.value = Math.abs(val) < 0.001 ? '0' : (val % 1 === 0 ? val.toString() : val.toFixed(2));
                input.setAttribute('data-row', row);
                input.setAttribute('data-col', col);
                input.addEventListener('input', (e) => {
                    const r = parseInt(e.target.getAttribute('data-row'));
                    const c = parseInt(e.target.getAttribute('data-col'));
                    matrix.values[r][c] = parseFloat(e.target.value) || 0;
                    this.visualizeInvariantSpaces();
                    this.scheduleStateSave();
                });
                grid.appendChild(input);
            }
        }
        
        gridContainer.appendChild(grid);
        
        const rightBracket = document.createElement('span');
        rightBracket.className = 'matrix-bracket';
        rightBracket.textContent = ']';
        gridContainer.appendChild(rightBracket);
        
        matrixContent.appendChild(gridContainer);
        mainRow.appendChild(matrixContent);
        
        // Controls container
        const controls = document.createElement('div');
        controls.className = 'matrix-controls';
        
        // Apply transformation button (play icon)
        const applyBtn = document.createElement('button');
        applyBtn.className = 'matrix-apply-btn';
        applyBtn.title = 'Apply transformation to all objects';
        applyBtn.innerHTML = `<svg width="10" height="12" viewBox="0 0 10 12"><polygon points="0,0 0,12 10,6" fill="currentColor" /></svg>`;
        applyBtn.addEventListener('click', () => this.applyMatrix(matrix.id));
        controls.appendChild(applyBtn);
        
        // Info button (i icon)
        const infoBtn = document.createElement('button');
        infoBtn.className = 'matrix-info-btn';
        infoBtn.title = 'Show eigenvalue information';
        infoBtn.textContent = 'i';
        infoBtn.addEventListener('click', () => this.showMatrixInfo(matrix.id));
        controls.appendChild(infoBtn);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Delete matrix';
        removeBtn.addEventListener('click', () => this.removeMatrix(matrix.id));
        controls.appendChild(removeBtn);
        
        mainRow.appendChild(controls);
        item.appendChild(mainRow);
        container.appendChild(item);
    }
    
    renderVectorItem(container, vec) {
        const item = document.createElement('div');
        item.className = vec.visible ? 'vector-item' : 'vector-item disabled';
        item.style.borderLeftColor = vec.color.getStyle();
        item.setAttribute('data-vector-id', vec.id);

        const mainRow = document.createElement('div');
        mainRow.className = 'vector-main-row';

        // Coordinates container
        const coordsDiv = document.createElement('div');
        coordsDiv.className = 'vector-coordinates';

        const vectorName = document.createElement('span');
        const displayName = vec.name || `V${vec.id}`;
        vectorName.textContent = displayName;
        vectorName.style.fontWeight = 'bold';
        vectorName.style.fontSize = '0.85em';
        vectorName.style.minWidth = '24px';
        vectorName.style.display = 'inline-block';
        vectorName.style.lineHeight = '1';
        vectorName.style.alignSelf = 'center';
        vectorName.style.verticalAlign = 'middle';
        vectorName.style.marginRight = '4px';
        vectorName.style.opacity = '0.9';
        coordsDiv.appendChild(vectorName);

        // Create input for x (i component)
        const xDiv = document.createElement('div');
        xDiv.className = 'vector-coord-input';
        const xVal = vec.currentEnd.x;
        const xFormatted = Math.abs(xVal) < 0.001 ? '0' : (xVal % 1 === 0 ? xVal.toString() : xVal.toFixed(2));
        xDiv.innerHTML = `
            <input type="number" step="0.1" value="${xFormatted}" data-axis="x">
            <label>i</label>
        `;
        coordsDiv.appendChild(xDiv);

        // Create input for y (j component)
        const yDiv = document.createElement('div');
        yDiv.className = 'vector-coord-input';
        const yVal = vec.currentEnd.y;
        const yFormatted = Math.abs(yVal) < 0.001 ? '0' : (yVal % 1 === 0 ? yVal.toString() : yVal.toFixed(2));
        yDiv.innerHTML = `
            <input type="number" step="0.1" value="${yFormatted}" data-axis="y">
            <label>j</label>
        `;
        coordsDiv.appendChild(yDiv);

        // Create input for z (k component, if 3D mode)
        if (this.dimension === '3d') {
            const zDiv = document.createElement('div');
            zDiv.className = 'vector-coord-input';
            const zVal = vec.currentEnd.z;
            const zFormatted = Math.abs(zVal) < 0.001 ? '0' : (zVal % 1 === 0 ? zVal.toString() : zVal.toFixed(2));
            zDiv.innerHTML = `
                <input type="number" step="0.1" value="${zFormatted}" data-axis="z">
                <label>k</label>
            `;
            coordsDiv.appendChild(zDiv);
        }

        // Add event listeners to inputs for live editing
        const inputs = coordsDiv.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const axis = e.target.getAttribute('data-axis');
                const value = parseFloat(e.target.value) || 0;
                vec.currentEnd[axis] = value;
                vec.originalEnd[axis] = value;
                this.updateVectorArrow(vec);
            });
        });

        mainRow.appendChild(coordsDiv);

        // Controls container
        const controls = document.createElement('div');
        controls.className = 'vector-controls';

        // Color indicator (toggles visibility)
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'color-indicator';
        colorIndicator.style.backgroundColor = vec.visible ? vec.color.getStyle() : 'transparent';
        colorIndicator.title = `Click to ${vec.visible ? 'hide' : 'show'} vector`;
        colorIndicator.style.cursor = 'pointer';
        colorIndicator.setAttribute('data-vector-id', vec.id);
        colorIndicator.addEventListener('click', (e) => {
            e.stopPropagation();
            const vectorId = parseInt(e.currentTarget.getAttribute('data-vector-id'));
            this.toggleVectorVisibility(vectorId);
        });
        controls.appendChild(colorIndicator);

        if (vec.visible) {
            const infoBtn = document.createElement('button');
            infoBtn.className = 'matrix-info-btn';
            infoBtn.title = 'Show vector information';
            infoBtn.textContent = 'i';
            infoBtn.addEventListener('click', () => this.showVectorInfo(vec.id));
            controls.appendChild(infoBtn);
        }

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Delete vector';
        removeBtn.addEventListener('click', () => this.removeVector(vec.id));
        controls.appendChild(removeBtn);

        mainRow.appendChild(controls);
        item.appendChild(mainRow);
        container.appendChild(item);
    }
    
    renderLineItem(container, line) {
        const item = document.createElement('div');
        item.className = line.visible ? 'vector-item' : 'vector-item disabled';
        item.style.borderLeftColor = line.color;
        item.setAttribute('data-line-id', line.id);

        const mainRow = document.createElement('div');
        mainRow.className = 'vector-main-row';

        // Line equation container with editable inputs
        const lineInfo = document.createElement('div');
        lineInfo.className = 'vector-coordinates';
        lineInfo.style.display = 'flex';
        lineInfo.style.flexDirection = 'column';
        lineInfo.style.gap = '3px';
        
        const formatNum = (val) => {
            if (Math.abs(val) < 0.001) return '0';
            const nearestInt = Math.round(val);
            if (Math.abs(val - nearestInt) < 0.0001) return nearestInt.toString();
            return val.toFixed(2);
        };
        const currentForm = this.normalizeLineFormPreference(line.formPreference);
        
        // Header: L1       r = a + tb
        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.gap = '4px';
        headerRow.style.fontSize = '0.85em';
        headerRow.style.marginBottom = '2px';
        
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = 'bold';
        nameSpan.textContent = line.name;
        headerRow.appendChild(nameSpan);
        
        // Spacer to align r with first input box
        const spacer = document.createElement('span');
        spacer.textContent = 'a =';
        spacer.style.visibility = 'hidden';
        spacer.style.fontSize = '0.85em';
        headerRow.appendChild(spacer);
        
        const equationSpan = document.createElement('span');
        if (currentForm === 'cross') {
            equationSpan.textContent = '(r - a) × b = 0';
        } else if (currentForm === 'cartesian') {
            equationSpan.innerHTML = this.dimension === '3d'
                ? '(x-a<sub>x</sub>)/b<sub>x</sub> = (y-a<sub>y</sub>)/b<sub>y</sub> = (z-a<sub>z</sub>)/b<sub>z</sub>'
                : '(x-a<sub>x</sub>)/b<sub>x</sub> = (y-a<sub>y</sub>)/b<sub>y</sub>';
        } else {
            equationSpan.textContent = 'r = a + tb';
        }
        headerRow.appendChild(equationSpan);
        
        lineInfo.appendChild(headerRow);
        
        // Row 2: a = (x, y, z)
        const aRow = document.createElement('div');
        aRow.style.display = 'flex';
        aRow.style.gap = '4px';
        aRow.style.alignItems = 'center';
        
        const aLabel = document.createElement('span');
        aLabel.textContent = 'a = (';
        aLabel.style.fontSize = '0.85em';
        aRow.appendChild(aLabel);
        
        // Point x
        const pxInput = document.createElement('input');
        pxInput.type = 'number';
        pxInput.step = '0.1';
        pxInput.value = formatNum(line.point.x);
        pxInput.className = 'equation-input';
        pxInput.addEventListener('input', (e) => {
            line.point.x = parseFloat(e.target.value) || 0;
            line.currentPoint.x = line.point.x; // Keep current values in sync
            line.originalPoint.x = line.point.x; // Keep original values in sync
            this.renderLine(line);
            this.updateIntersections();
        });
        aRow.appendChild(pxInput);
        
        const comma1 = document.createElement('span');
        comma1.textContent = ',';
        comma1.style.fontSize = '0.85em';
        aRow.appendChild(comma1);
        
        // Point y
        const pyInput = document.createElement('input');
        pyInput.type = 'number';
        pyInput.step = '0.1';
        pyInput.value = formatNum(line.point.y);
        pyInput.className = 'equation-input';
        pyInput.addEventListener('input', (e) => {
            line.point.y = parseFloat(e.target.value) || 0;
            line.currentPoint.y = line.point.y; // Keep current values in sync
            line.originalPoint.y = line.point.y; // Keep original values in sync
            this.renderLine(line);
            this.updateIntersections();
        });
        aRow.appendChild(pyInput);
        
        if (this.dimension === '3d') {
            const comma2 = document.createElement('span');
            comma2.textContent = ',';
            comma2.style.fontSize = '0.85em';
            aRow.appendChild(comma2);
            
            // Point z
            const pzInput = document.createElement('input');
            pzInput.type = 'number';
            pzInput.step = '0.1';
            pzInput.value = formatNum(line.point.z);
            pzInput.className = 'equation-input';
            pzInput.addEventListener('input', (e) => {
                line.point.z = parseFloat(e.target.value) || 0;
                line.currentPoint.z = line.point.z; // Keep current values in sync
                line.originalPoint.z = line.point.z; // Keep original values in sync
                this.renderLine(line);
                this.updateIntersections();
            });
            aRow.appendChild(pzInput);
        }
        
        const closeParen1 = document.createElement('span');
        closeParen1.textContent = ')';
        closeParen1.style.fontSize = '0.85em';
        aRow.appendChild(closeParen1);
        
        lineInfo.appendChild(aRow);
        
        // Row 3: b = (dx, dy, dz)
        const bRow = document.createElement('div');
        bRow.style.display = 'flex';
        bRow.style.gap = '4px';
        bRow.style.alignItems = 'center';
        
        const bLabel = document.createElement('span');
        bLabel.textContent = 'b = (';
        bLabel.style.fontSize = '0.85em';
        bRow.appendChild(bLabel);
        
        // Direction x
        const dxInput = document.createElement('input');
        dxInput.type = 'number';
        dxInput.step = '0.1';
        dxInput.value = formatNum(line.direction.x);
        dxInput.className = 'equation-input';
        dxInput.addEventListener('input', (e) => {
            line.direction.x = parseFloat(e.target.value) || 0;
            line.currentDirection.x = line.direction.x; // Keep current values in sync
            line.originalDirection.x = line.direction.x; // Keep original values in sync
            this.renderLine(line);
            this.updateIntersections();
        });
        bRow.appendChild(dxInput);
        
        const comma3 = document.createElement('span');
        comma3.textContent = ',';
        comma3.style.fontSize = '0.85em';
        bRow.appendChild(comma3);
        
        // Direction y
        const dyInput = document.createElement('input');
        dyInput.type = 'number';
        dyInput.step = '0.1';
        dyInput.value = formatNum(line.direction.y);
        dyInput.className = 'equation-input';
        dyInput.addEventListener('input', (e) => {
            line.direction.y = parseFloat(e.target.value) || 0;
            line.currentDirection.y = line.direction.y; // Keep current values in sync
            line.originalDirection.y = line.direction.y; // Keep original values in sync
            this.renderLine(line);
            this.updateIntersections();
        });
        bRow.appendChild(dyInput);
        
        if (this.dimension === '3d') {
            const comma4 = document.createElement('span');
            comma4.textContent = ',';
            comma4.style.fontSize = '0.85em';
            bRow.appendChild(comma4);
            
            // Direction z
            const dzInput = document.createElement('input');
            dzInput.type = 'number';
            dzInput.step = '0.1';
            dzInput.value = formatNum(line.direction.z);
            dzInput.className = 'equation-input';
            dzInput.addEventListener('input', (e) => {
                line.direction.z = parseFloat(e.target.value) || 0;
                line.currentDirection.z = line.direction.z; // Keep current values in sync
                line.originalDirection.z = line.direction.z; // Keep original values in sync
                this.renderLine(line);
                this.updateIntersections();
            });
            bRow.appendChild(dzInput);
        }
        
        const closeParen2 = document.createElement('span');
        closeParen2.textContent = ')';
        closeParen2.style.fontSize = '0.85em';
        bRow.appendChild(closeParen2);
        
        lineInfo.appendChild(bRow);
        mainRow.appendChild(lineInfo);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'vector-controls';

        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'color-indicator';
        colorIndicator.style.backgroundColor = line.visible ? line.color : 'transparent';
        colorIndicator.title = `Click to ${line.visible ? 'hide' : 'show'} line`;
        colorIndicator.style.cursor = 'pointer';
        colorIndicator.addEventListener('click', () => this.toggleLineVisibility(line.id));
        controls.appendChild(colorIndicator);

        const formToggleBtn = document.createElement('button');
        formToggleBtn.className = 'form-toggle-btn';
        const formLabelMap = {
            parametric: 'P',
            cross: '×',
            cartesian: 'C'
        };
        const nextFormMap = {
            parametric: 'cross',
            cross: 'cartesian',
            cartesian: 'parametric'
        };
        const formTitleMap = {
            parametric: 'Parametric',
            cross: 'Cross Product',
            cartesian: 'Cartesian'
        };
        const nextForm = nextFormMap[currentForm];
        formToggleBtn.textContent = formLabelMap[currentForm];
        formToggleBtn.title = `Toggle to ${formTitleMap[nextForm]} form`;
        formToggleBtn.addEventListener('click', () => {
            line.formPreference = nextFormMap[this.normalizeLineFormPreference(line.formPreference)];
            this.updateObjectsList();
            this.scheduleStateSave();
        });
        controls.appendChild(formToggleBtn);
        
        // Info button (i icon)
        if (line.visible) {
            const infoBtn = document.createElement('button');
            infoBtn.className = 'matrix-info-btn';
            infoBtn.title = 'Show line information';
            infoBtn.textContent = 'i';
            infoBtn.addEventListener('click', () => this.showLineInfo(line.id));
            controls.appendChild(infoBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Delete line';
        removeBtn.addEventListener('click', () => this.removeLine(line.id));
        controls.appendChild(removeBtn);

        mainRow.appendChild(controls);
        item.appendChild(mainRow);
        container.appendChild(item);
    }
    
    renderPlaneItem(container, plane) {
        const item = document.createElement('div');
        item.className = plane.visible ? 'vector-item' : 'vector-item disabled';
        item.style.borderLeftColor = plane.color;
        item.setAttribute('data-plane-id', plane.id);

        const mainRow = document.createElement('div');
        mainRow.className = 'vector-main-row';

        // Plane equation container with editable inputs
        const planeInfo = document.createElement('div');
        planeInfo.className = 'vector-coordinates';
        planeInfo.style.display = 'flex';
        planeInfo.style.flexDirection = 'column';
        planeInfo.style.gap = '3px';
        
        const formatNum = (val) => {
            if (Math.abs(val) < 0.001) return '0';
            const nearestInt = Math.round(val);
            if (Math.abs(val - nearestInt) < 0.0001) return nearestInt.toString();
            return val.toFixed(2);
        };
        
        // Header: P1
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = 'bold';
        nameSpan.style.fontSize = '0.85em';
        nameSpan.style.marginBottom = '2px';
        nameSpan.textContent = plane.name;
        planeInfo.appendChild(nameSpan);
        
        const currentForm = this.normalizePlaneFormPreference(plane.formPreference);
        plane.formPreference = currentForm;

        // Render based on form preference
        if (currentForm === 'cartesian') {
            this.renderCartesianForm(planeInfo, plane, formatNum);
        } else if (currentForm === 'vector') {
            this.renderVectorForm(planeInfo, plane, formatNum);
        } else if (currentForm === 'scalar') {
            this.renderScalarForm(planeInfo, plane, formatNum);
        } else {
            this.renderDotForm(planeInfo, plane, formatNum);
        }
        
        mainRow.appendChild(planeInfo);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'vector-controls';

        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'color-indicator';
        colorIndicator.style.backgroundColor = plane.visible ? plane.color : 'transparent';
        colorIndicator.title = `Click to ${plane.visible ? 'hide' : 'show'} plane`;
        colorIndicator.style.cursor = 'pointer';
        colorIndicator.addEventListener('click', () => this.togglePlaneVisibility(plane.id));
        controls.appendChild(colorIndicator);

        // Form toggle button (C|V|S)
        const formToggleBtn = document.createElement('button');
        formToggleBtn.className = 'form-toggle-btn';
        const formLabelMap = {
            cartesian: 'C',
            vector: 'V',
            scalar: 'S',
            dot: 'D'
        };
        const formTitleMap = {
            cartesian: 'Cartesian',
            vector: 'Vector',
            scalar: 'Scalar Product',
            dot: 'Dot Product'
        };
        const normalizedForm = this.normalizePlaneFormPreference(plane.formPreference);
        const nextForm = this.getNextPlaneFormPreference(normalizedForm);
        formToggleBtn.textContent = formLabelMap[normalizedForm] || 'D';
        formToggleBtn.title = `Toggle to ${formTitleMap[nextForm]} form`;
        formToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            plane.formPreference = this.getNextPlaneFormPreference(plane.formPreference);
            this.updateObjectsList(); // Just refresh UI
            this.scheduleStateSave();
        });
        controls.appendChild(formToggleBtn);
        
        // Info button (i icon)
        if (plane.visible) {
            const infoBtn = document.createElement('button');
            infoBtn.className = 'matrix-info-btn';
            infoBtn.title = 'Show plane information';
            infoBtn.textContent = 'i';
            infoBtn.addEventListener('click', () => this.showPlaneInfo(plane.id));
            controls.appendChild(infoBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Delete plane';
        removeBtn.addEventListener('click', () => this.removePlane(plane.id));
        controls.appendChild(removeBtn);

        mainRow.appendChild(controls);
        item.appendChild(mainRow);
        container.appendChild(item);
    }

    renderCartesianForm(planeInfo, plane, formatNum) {
        // Row 1: [a]x + [b]y +
        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '4px';
        row1.style.alignItems = 'center';
        
        const aInput = document.createElement('input');
        aInput.type = 'number';
        aInput.step = '0.1';
        aInput.value = formatNum(plane.a);
        aInput.className = 'equation-input';
        aInput.addEventListener('input', (e) => {
            plane.a = parseFloat(e.target.value) || 0;
            plane.currentA = plane.a;
            plane.originalA = plane.a;
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row1.appendChild(aInput);
        
        const xLabel = document.createElement('span');
        xLabel.textContent = 'x +';
        xLabel.style.fontSize = '0.85em';
        row1.appendChild(xLabel);
        
        const bInput = document.createElement('input');
        bInput.type = 'number';
        bInput.step = '0.1';
        bInput.value = formatNum(plane.b);
        bInput.className = 'equation-input';
        bInput.addEventListener('input', (e) => {
            plane.b = parseFloat(e.target.value) || 0;
            plane.currentB = plane.b;
            plane.originalB = plane.b;
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row1.appendChild(bInput);
        
        const yLabel = document.createElement('span');
        yLabel.textContent = 'y +';
        yLabel.style.fontSize = '0.85em';
        row1.appendChild(yLabel);
        
        planeInfo.appendChild(row1);
        
        // Row 2: [c]z = [d]
        const row2 = document.createElement('div');
        row2.style.display = 'flex';
        row2.style.gap = '4px';
        row2.style.alignItems = 'center';
        
        const cInput = document.createElement('input');
        cInput.type = 'number';
        cInput.step = '0.1';
        cInput.value = formatNum(plane.c);
        cInput.className = 'equation-input';
        cInput.addEventListener('input', (e) => {
            plane.c = parseFloat(e.target.value) || 0;
            plane.currentC = plane.c;
            plane.originalC = plane.c;
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row2.appendChild(cInput);
        
        const zLabel = document.createElement('span');
        zLabel.textContent = 'z =';
        zLabel.style.fontSize = '0.85em';
        row2.appendChild(zLabel);
        
        const dInput = document.createElement('input');
        dInput.type = 'number';
        dInput.step = '0.1';
        dInput.value = formatNum(plane.d);
        dInput.className = 'equation-input';
        dInput.addEventListener('input', (e) => {
            plane.d = parseFloat(e.target.value) || 0;
            plane.currentD = plane.d;
            plane.originalD = plane.d;
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row2.appendChild(dInput);
        
        planeInfo.appendChild(row2);
    }

    renderVectorForm(planeInfo, plane, formatNum) {
        // Convert current Cartesian to Vector form for display
        const vectorForm = this.cartesianToVector(plane.a, plane.b, plane.c, plane.d);
        
        // Row 1: r₀ = ([x], [y], [z])
        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '4px';
        row1.style.alignItems = 'center';
        
        const r0Label = document.createElement('span');
        r0Label.textContent = 'r₀ = (';
        r0Label.style.fontSize = '0.85em';
        r0Label.style.minWidth = '36px';
        row1.appendChild(r0Label);
        
        const r0xInput = document.createElement('input');
        r0xInput.type = 'number';
        r0xInput.step = '0.1';
        r0xInput.value = formatNum(vectorForm.r0.x);
        r0xInput.className = 'equation-input';
        row1.appendChild(r0xInput);
        
        const comma1 = document.createElement('span');
        comma1.textContent = ',';
        comma1.style.fontSize = '0.85em';
        row1.appendChild(comma1);
        
        const r0yInput = document.createElement('input');
        r0yInput.type = 'number';
        r0yInput.step = '0.1';
        r0yInput.value = formatNum(vectorForm.r0.y);
        r0yInput.className = 'equation-input';
        row1.appendChild(r0yInput);
        
        const comma2 = document.createElement('span');
        comma2.textContent = ',';
        comma2.style.fontSize = '0.85em';
        row1.appendChild(comma2);
        
        const r0zInput = document.createElement('input');
        r0zInput.type = 'number';
        r0zInput.step = '0.1';
        r0zInput.value = formatNum(vectorForm.r0.z);
        r0zInput.className = 'equation-input';
        row1.appendChild(r0zInput);
        
        const closeParen1 = document.createElement('span');
        closeParen1.textContent = ')';
        closeParen1.style.fontSize = '0.85em';
        row1.appendChild(closeParen1);
        
        planeInfo.appendChild(row1);
        
        // Row 2: u = ([x], [y], [z])
        const row2 = document.createElement('div');
        row2.style.display = 'flex';
        row2.style.gap = '4px';
        row2.style.alignItems = 'center';
        
        const uLabel = document.createElement('span');
        uLabel.textContent = 'u = (';
        uLabel.style.fontSize = '0.85em';
        uLabel.style.minWidth = '36px';
        row2.appendChild(uLabel);
        
        const uxInput = document.createElement('input');
        uxInput.type = 'number';
        uxInput.step = '0.1';
        uxInput.value = formatNum(vectorForm.u.x);
        uxInput.className = 'equation-input';
        row2.appendChild(uxInput);
        
        const comma3 = document.createElement('span');
        comma3.textContent = ',';
        comma3.style.fontSize = '0.85em';
        row2.appendChild(comma3);
        
        const uyInput = document.createElement('input');
        uyInput.type = 'number';
        uyInput.step = '0.1';
        uyInput.value = formatNum(vectorForm.u.y);
        uyInput.className = 'equation-input';
        row2.appendChild(uyInput);
        
        const comma4 = document.createElement('span');
        comma4.textContent = ',';
        comma4.style.fontSize = '0.85em';
        row2.appendChild(comma4);
        
        const uzInput = document.createElement('input');
        uzInput.type = 'number';
        uzInput.step = '0.1';
        uzInput.value = formatNum(vectorForm.u.z);
        uzInput.className = 'equation-input';
        row2.appendChild(uzInput);
        
        const closeParen2 = document.createElement('span');
        closeParen2.textContent = ')';
        closeParen2.style.fontSize = '0.85em';
        row2.appendChild(closeParen2);
        
        planeInfo.appendChild(row2);
        
        // Row 3: v = ([x], [y], [z])
        const row3 = document.createElement('div');
        row3.style.display = 'flex';
        row3.style.gap = '4px';
        row3.style.alignItems = 'center';
        
        const vLabel = document.createElement('span');
        vLabel.textContent = 'v = (';
        vLabel.style.fontSize = '0.85em';
        vLabel.style.minWidth = '36px';
        row3.appendChild(vLabel);
        
        const vxInput = document.createElement('input');
        vxInput.type = 'number';
        vxInput.step = '0.1';
        vxInput.value = formatNum(vectorForm.v.x);
        vxInput.className = 'equation-input';
        row3.appendChild(vxInput);
        
        const comma5 = document.createElement('span');
        comma5.textContent = ',';
        comma5.style.fontSize = '0.85em';
        row3.appendChild(comma5);
        
        const vyInput = document.createElement('input');
        vyInput.type = 'number';
        vyInput.step = '0.1';
        vyInput.value = formatNum(vectorForm.v.y);
        vyInput.className = 'equation-input';
        row3.appendChild(vyInput);
        
        const comma6 = document.createElement('span');
        comma6.textContent = ',';
        comma6.style.fontSize = '0.85em';
        row3.appendChild(comma6);
        
        const vzInput = document.createElement('input');
        vzInput.type = 'number';
        vzInput.step = '0.1';
        vzInput.value = formatNum(vectorForm.v.z);
        vzInput.className = 'equation-input';
        row3.appendChild(vzInput);
        
        const closeParen3 = document.createElement('span');
        closeParen3.textContent = ')';
        closeParen3.style.fontSize = '0.85em';
        row3.appendChild(closeParen3);
        
        planeInfo.appendChild(row3);
        
        // Add input listeners to convert back to Cartesian when edited
        const updateFromVector = () => {
            const r0 = {
                x: parseFloat(r0xInput.value) || 0,
                y: parseFloat(r0yInput.value) || 0,
                z: parseFloat(r0zInput.value) || 0
            };
            const u = {
                x: parseFloat(uxInput.value) || 0,
                y: parseFloat(uyInput.value) || 0,
                z: parseFloat(uzInput.value) || 0
            };
            const v = {
                x: parseFloat(vxInput.value) || 0,
                y: parseFloat(vyInput.value) || 0,
                z: parseFloat(vzInput.value) || 0
            };
            
            const cartesian = this.vectorToCartesian(r0, u, v);
            plane.a = cartesian.a;
            plane.b = cartesian.b;
            plane.c = cartesian.c;
            plane.d = cartesian.d;
            plane.currentA = plane.a;
            plane.currentB = plane.b;
            plane.currentC = plane.c;
            plane.currentD = plane.d;
            plane.originalA = plane.a;
            plane.originalB = plane.b;
            plane.originalC = plane.c;
            plane.originalD = plane.d;
            this.renderPlane(plane);
            this.updateIntersections();
        };
        
        [r0xInput, r0yInput, r0zInput, uxInput, uyInput, uzInput, vxInput, vyInput, vzInput].forEach(input => {
            input.addEventListener('input', updateFromVector);
        });
    }

    renderScalarForm(planeInfo, plane, formatNum) {
        const scalarForm = this.cartesianToScalar(plane.a, plane.b, plane.c, plane.d);

        const equationRow = document.createElement('div');
        equationRow.style.fontSize = '0.8em';
        equationRow.style.opacity = '0.85';
        equationRow.textContent = '(r - a) · n = 0';
        planeInfo.appendChild(equationRow);

        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '4px';
        row1.style.alignItems = 'center';

        const aLabel = document.createElement('span');
        aLabel.textContent = 'a = (';
        aLabel.style.fontSize = '0.85em';
        aLabel.style.minWidth = '36px';
        row1.appendChild(aLabel);

        const axInput = document.createElement('input');
        axInput.type = 'number';
        axInput.step = '0.1';
        axInput.value = formatNum(scalarForm.anchor.x);
        axInput.className = 'equation-input';
        row1.appendChild(axInput);

        const comma1 = document.createElement('span');
        comma1.textContent = ',';
        comma1.style.fontSize = '0.85em';
        row1.appendChild(comma1);

        const ayInput = document.createElement('input');
        ayInput.type = 'number';
        ayInput.step = '0.1';
        ayInput.value = formatNum(scalarForm.anchor.y);
        ayInput.className = 'equation-input';
        row1.appendChild(ayInput);

        const comma2 = document.createElement('span');
        comma2.textContent = ',';
        comma2.style.fontSize = '0.85em';
        row1.appendChild(comma2);

        const azInput = document.createElement('input');
        azInput.type = 'number';
        azInput.step = '0.1';
        azInput.value = formatNum(scalarForm.anchor.z);
        azInput.className = 'equation-input';
        row1.appendChild(azInput);

        const closeParen1 = document.createElement('span');
        closeParen1.textContent = ')';
        closeParen1.style.fontSize = '0.85em';
        row1.appendChild(closeParen1);

        planeInfo.appendChild(row1);

        const row2 = document.createElement('div');
        row2.style.display = 'flex';
        row2.style.gap = '4px';
        row2.style.alignItems = 'center';

        const nLabel = document.createElement('span');
        nLabel.textContent = 'n = (';
        nLabel.style.fontSize = '0.85em';
        nLabel.style.minWidth = '36px';
        row2.appendChild(nLabel);

        const nxInput = document.createElement('input');
        nxInput.type = 'number';
        nxInput.step = '0.1';
        nxInput.value = formatNum(scalarForm.normal.x);
        nxInput.className = 'equation-input';
        row2.appendChild(nxInput);

        const comma3 = document.createElement('span');
        comma3.textContent = ',';
        comma3.style.fontSize = '0.85em';
        row2.appendChild(comma3);

        const nyInput = document.createElement('input');
        nyInput.type = 'number';
        nyInput.step = '0.1';
        nyInput.value = formatNum(scalarForm.normal.y);
        nyInput.className = 'equation-input';
        row2.appendChild(nyInput);

        const comma4 = document.createElement('span');
        comma4.textContent = ',';
        comma4.style.fontSize = '0.85em';
        row2.appendChild(comma4);

        const nzInput = document.createElement('input');
        nzInput.type = 'number';
        nzInput.step = '0.1';
        nzInput.value = formatNum(scalarForm.normal.z);
        nzInput.className = 'equation-input';
        row2.appendChild(nzInput);

        const closeParen2 = document.createElement('span');
        closeParen2.textContent = ')';
        closeParen2.style.fontSize = '0.85em';
        row2.appendChild(closeParen2);

        planeInfo.appendChild(row2);

        const updateFromScalar = () => {
            const anchor = {
                x: parseFloat(axInput.value) || 0,
                y: parseFloat(ayInput.value) || 0,
                z: parseFloat(azInput.value) || 0
            };
            const normal = {
                x: parseFloat(nxInput.value) || 0,
                y: parseFloat(nyInput.value) || 0,
                z: parseFloat(nzInput.value) || 0
            };

            const cartesian = this.scalarToCartesian(anchor, normal);
            plane.a = cartesian.a;
            plane.b = cartesian.b;
            plane.c = cartesian.c;
            plane.d = cartesian.d;
            plane.currentA = plane.a;
            plane.currentB = plane.b;
            plane.currentC = plane.c;
            plane.currentD = plane.d;
            plane.originalA = plane.a;
            plane.originalB = plane.b;
            plane.originalC = plane.c;
            plane.originalD = plane.d;
            this.renderPlane(plane);
            this.updateIntersections();
        };

        [axInput, ayInput, azInput, nxInput, nyInput, nzInput].forEach(input => {
            input.addEventListener('input', updateFromScalar);
        });
    }

    renderDotForm(planeInfo, plane, formatNum) {
        const equationRow = document.createElement('div');
        equationRow.style.fontSize = '0.8em';
        equationRow.style.opacity = '0.85';
        equationRow.textContent = 'r · n = d';
        planeInfo.appendChild(equationRow);

        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '4px';
        row1.style.alignItems = 'center';

        const nLabel = document.createElement('span');
        nLabel.textContent = 'n = (';
        nLabel.style.fontSize = '0.85em';
        nLabel.style.minWidth = '36px';
        row1.appendChild(nLabel);

        const nxInput = document.createElement('input');
        nxInput.type = 'number';
        nxInput.step = '0.1';
        nxInput.value = formatNum(plane.a);
        nxInput.className = 'equation-input';
        row1.appendChild(nxInput);

        const comma1 = document.createElement('span');
        comma1.textContent = ',';
        comma1.style.fontSize = '0.85em';
        row1.appendChild(comma1);

        const nyInput = document.createElement('input');
        nyInput.type = 'number';
        nyInput.step = '0.1';
        nyInput.value = formatNum(plane.b);
        nyInput.className = 'equation-input';
        row1.appendChild(nyInput);

        const comma2 = document.createElement('span');
        comma2.textContent = ',';
        comma2.style.fontSize = '0.85em';
        row1.appendChild(comma2);

        const nzInput = document.createElement('input');
        nzInput.type = 'number';
        nzInput.step = '0.1';
        nzInput.value = formatNum(plane.c);
        nzInput.className = 'equation-input';
        row1.appendChild(nzInput);

        const closeParen = document.createElement('span');
        closeParen.textContent = ')';
        closeParen.style.fontSize = '0.85em';
        row1.appendChild(closeParen);

        planeInfo.appendChild(row1);

        const row2 = document.createElement('div');
        row2.style.display = 'flex';
        row2.style.gap = '4px';
        row2.style.alignItems = 'center';

        const dLabel = document.createElement('span');
        dLabel.textContent = 'd =';
        dLabel.style.fontSize = '0.85em';
        dLabel.style.minWidth = '36px';
        row2.appendChild(dLabel);

        const dInput = document.createElement('input');
        dInput.type = 'number';
        dInput.step = '0.1';
        dInput.value = formatNum(plane.d);
        dInput.className = 'equation-input';
        row2.appendChild(dInput);

        planeInfo.appendChild(row2);

        const updateFromDot = () => {
            plane.a = parseFloat(nxInput.value) || 0;
            plane.b = parseFloat(nyInput.value) || 0;
            plane.c = parseFloat(nzInput.value) || 0;
            plane.d = parseFloat(dInput.value) || 0;
            plane.currentA = plane.a;
            plane.currentB = plane.b;
            plane.currentC = plane.c;
            plane.currentD = plane.d;
            plane.originalA = plane.a;
            plane.originalB = plane.b;
            plane.originalC = plane.c;
            plane.originalD = plane.d;
            this.renderPlane(plane);
            this.updateIntersections();
        };

        [nxInput, nyInput, nzInput, dInput].forEach(input => {
            input.addEventListener('input', updateFromDot);
        });
    }

    updateVectorArrow(vec) {
        // Remove old arrow
        this.scene.remove(vec.arrow);
        
        // Create new arrow
        const direction = vec.currentEnd.clone().normalize();
        const length = vec.currentEnd.length();
        
        if (length > 0) {
            const thickness = this.getVectorArrowThickness();
            vec.arrow = this.createSmoothArrow(
                direction,
                new THREE.Vector3(0, 0, 0),
                length,
                vec.color,
                thickness.headLength,
                thickness.headWidth
            );
            
            // Update point sphere position
            if (vec.pointSphere) {
                vec.pointSphere.position.copy(vec.currentEnd);
            }
            
            // Re-add to scene based on current mode and visibility
            this.updateVectorDisplay();
        }

        if (!this.isAnimating) {
            this.scheduleStateSave();
        }
    }

    removeVector(id) {
        const index = this.vectors.findIndex(v => v.id === id);
        if (index !== -1) {
            const vec = this.vectors[index];
            const removedPresetVertex =
                this.presetEdges.some(edge => edge.startId === id || edge.endId === id) ||
                this.presetFaces.some(face => face.aId === id || face.bId === id || face.cId === id);
            // Remove all visualizations
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
            this.disposeVectorLabel(vec);
            
            this.vectors.splice(index, 1);

            if (this.vectorInfoPanelId === id) {
                this.vectorInfoPanelId = null;
                document.getElementById('vector-info-panel').style.display = 'none';
            }

            if (this.angleVisualizationState && this.angleVisualizationState.vectorId === id) {
                this.angleVisualizationState = null;
                this.clearAngleVisualization();
            }

            // If any single preset vertex is deleted, revert to normal vectors (no joined edges)
            if (removedPresetVertex) {
                this.clearPresetEdges();
            }
            
            this.updateVectorDisplay();
            
            this.updateVectorList();
            this.scheduleStateSave();
        }
    }

    toggleVectorVisibility(id) {
        const vec = this.vectors.find(v => v.id === id);
        if (vec) {
            vec.visible = !vec.visible;

            if (!vec.visible && this.vectorInfoPanelId === id) {
                this.vectorInfoPanelId = null;
                document.getElementById('vector-info-panel').style.display = 'none';
            }
            
            // Update visualization based on current mode
            this.updateVectorDisplay();
            
            // Update the list to reflect the change
            this.updateObjectsList();
            this.scheduleStateSave();
        }
    }
    
    toggleLineVisibility(id) {
        const line = this.lines.find(l => l.id === id);
        if (line) {
            line.visible = !line.visible;

            if (!line.visible && this.lineInfoPanelId === id) {
                this.lineInfoPanelId = null;
                document.getElementById('line-info-panel').style.display = 'none';
            }

            if (line.mesh) {
                line.mesh.visible = line.visible;
            }
            this.updateObjectsList();
            this.updateIntersections();
            this.scheduleStateSave();
        }
    }
    
    togglePlaneVisibility(id) {
        const plane = this.planes.find(p => p.id === id);
        if (plane) {
            plane.visible = !plane.visible;

            if (!plane.visible && this.planeInfoPanelId === id) {
                this.planeInfoPanelId = null;
                document.getElementById('plane-info-panel').style.display = 'none';
            }

            if (plane.mesh) {
                plane.mesh.visible = plane.visible;
            }
            this.updateObjectsList();
            this.updateIntersections();
            this.scheduleStateSave();
        }
    }
    
    removeLine(id) {
        const index = this.lines.findIndex(l => l.id === id);
        if (index !== -1) {
            const line = this.lines[index];
            if (line.mesh) {
                this.scene.remove(line.mesh);
            }
            this.lines.splice(index, 1);
            
            // Hide line info panel if showing this line
            if (this.lineInfoPanelId === id) {
                this.lineInfoPanelId = null;
                document.getElementById('line-info-panel').style.display = 'none';
            }

            if (this.angleVisualizationState && (this.angleVisualizationState.lineId === id || this.angleVisualizationState.otherLineId === id)) {
                this.angleVisualizationState = null;
                this.clearAngleVisualization();
            }
            
            this.updateObjectsList();
            this.updateIntersections();
            this.scheduleStateSave();
        }
    }
    
    removePlane(id) {
        const index = this.planes.findIndex(p => p.id === id);
        if (index !== -1) {
            const plane = this.planes[index];
            if (plane.mesh) {
                this.scene.remove(plane.mesh);
            }
            this.planes.splice(index, 1);
            
            // Hide plane info panel if showing this plane
            if (this.planeInfoPanelId === id) {
                this.planeInfoPanelId = null;
                document.getElementById('plane-info-panel').style.display = 'none';
            }

            if (this.angleVisualizationState && (this.angleVisualizationState.planeId === id || this.angleVisualizationState.otherPlaneId === id)) {
                this.angleVisualizationState = null;
                this.clearAngleVisualization();
            }
            
            this.updateObjectsList();
            this.updateIntersections();
            this.scheduleStateSave();
        }
    }

    // Convert Cartesian form (ax+by+cz=d) to Vector form (r=r₀+su+tv)
    cartesianToVector(a, b, c, d) {
        const epsilon = 1e-10;
        
        // Find a point r₀ on the plane
        let r0;
        if (Math.abs(a) > epsilon) {
            r0 = { x: d/a, y: 0, z: 0 };
        } else if (Math.abs(b) > epsilon) {
            r0 = { x: 0, y: d/b, z: 0 };
        } else if (Math.abs(c) > epsilon) {
            r0 = { x: 0, y: 0, z: d/c };
        } else {
            r0 = { x: 0, y: 0, z: 0 }; // Degenerate case
        }
        
        // Find two direction vectors perpendicular to normal n=(a,b,c)
        const n = new THREE.Vector3(a, b, c);
        
        // First direction vector u: perpendicular to n
        let u;
        if (Math.abs(a) > epsilon || Math.abs(b) > epsilon) {
            u = new THREE.Vector3(-b, a, 0).normalize();
        } else {
            u = new THREE.Vector3(1, 0, 0);
        }
        
        // Second direction vector v: perpendicular to both n and u
        const v = new THREE.Vector3().crossVectors(n, u).normalize();
        
        return {
            r0: r0,
            u: { x: u.x, y: u.y, z: u.z },
            v: { x: v.x, y: v.y, z: v.z }
        };
    }

    // Convert Vector form (r=r₀+su+tv) to Cartesian form (ax+by+cz=d)
    vectorToCartesian(r0, u, v) {
        // Normal vector is u × v
        const uVec = new THREE.Vector3(u.x, u.y, u.z);
        const vVec = new THREE.Vector3(v.x, v.y, v.z);
        const normal = new THREE.Vector3().crossVectors(uVec, vVec);
        
        // Normalize for cleaner values
        const len = normal.length();
        if (len < 1e-10) {
            // Degenerate case: u and v are parallel
            return { a: 0, b: 0, c: 1, d: 0 };
        }
        
        const a = normal.x / len;
        const b = normal.y / len;
        const c = normal.z / len;
        
        // d = n · r₀
        const d = a * r0.x + b * r0.y + c * r0.z;
        
        return { a, b, c, d };
    }

    // Convert Cartesian form (ax+by+cz=d) to Scalar product form ((r-a)·n=0)
    cartesianToScalar(a, b, c, d) {
        const vectorForm = this.cartesianToVector(a, b, c, d);
        return {
            anchor: vectorForm.r0,
            normal: { x: a, y: b, z: c }
        };
    }

    // Convert Scalar product form ((r-a)·n=0) to Cartesian form (ax+by+cz=d)
    scalarToCartesian(anchor, normal) {
        const a = normal.x;
        const b = normal.y;
        const c = normal.z;
        const d = (a * anchor.x) + (b * anchor.y) + (c * anchor.z);
        return { a, b, c, d };
    }

    applyMatrix(id) {
        // Check if eigenvalue panel is currently displayed
        const panel = document.getElementById('eigenvalue-panel');
        const isPanelVisible = panel.style.display !== 'none';
        
        // If panel is visible, update it to show this matrix's info
        if (isPanelVisible) {
            this.eigenvaluePanelMatrixId = id;
            if (this.invariantDisplayMode !== 'off') {
                this.visualizeInvariantSpaces(id);
            } else {
                this.updateEigenvaluePanel(id);
            }
        }
        
        // Apply this matrix transformation to all vectors
        this.animateTransformation(id);
    }

    showMatrixInfo(id) {
        // Hide other info panels
        document.getElementById('vector-info-panel').style.display = 'none';
        document.getElementById('line-info-panel').style.display = 'none';
        document.getElementById('plane-info-panel').style.display = 'none';
        this.vectorInfoPanelId = null;
        this.lineInfoPanelId = null;
        this.planeInfoPanelId = null;
        this.angleVisualizationState = null;
        this.clearAngleVisualization();
        
        // Toggle eigenvalue panel for this matrix
        if (this.eigenvaluePanelMatrixId === id) {
            // Already showing this matrix, hide panel
            this.eigenvaluePanelMatrixId = null;
            // Reset invariant spaces to off when closing panel
            this.invariantDisplayMode = 'off';
            this.clearInvariantSpaces();
        } else {
            // Show panel for this matrix
            // Reset invariant spaces to off when switching matrices
            this.invariantDisplayMode = 'off';
            this.clearInvariantSpaces();
            this.eigenvaluePanelMatrixId = id;
            this.closePanelOnMobile();
        }
        
        // Update the eigenvalue panel
        this.updateEigenvaluePanel();
    }

    showLineInfo(id) {
        const line = this.lines.find(l => l.id === id);
        if (!line || !line.visible) {
            if (this.lineInfoPanelId === id) {
                this.lineInfoPanelId = null;
            }
            document.getElementById('line-info-panel').style.display = 'none';
            return;
        }

        // Hide other info panels
        document.getElementById('eigenvalue-panel').style.display = 'none';
        document.getElementById('vector-info-panel').style.display = 'none';
        document.getElementById('plane-info-panel').style.display = 'none';
        this.eigenvaluePanelMatrixId = null;
        this.vectorInfoPanelId = null;
        this.planeInfoPanelId = null;
        
        // Clear invariant spaces when switching away from matrix panel
        this.invariantDisplayMode = 'off';
        this.clearInvariantSpaces();
        this.angleVisualizationState = null;
        this.clearAngleVisualization();
        
        // Toggle line info panel for this line
        if (this.lineInfoPanelId === id) {
            // Already showing this line, hide panel
            this.lineInfoPanelId = null;
            this.angleVisualizationState = null;
            this.clearAngleVisualization();
        } else {
            // Show panel for this line
            this.lineInfoPanelId = id;
            this.closePanelOnMobile();
        }
        
        // Update the line info panel
        this.updateLinePanel();
    }

    showPlaneInfo(id) {
        const plane = this.planes.find(p => p.id === id);
        if (!plane || !plane.visible) {
            if (this.planeInfoPanelId === id) {
                this.planeInfoPanelId = null;
            }
            document.getElementById('plane-info-panel').style.display = 'none';
            return;
        }

        // Hide other info panels
        document.getElementById('eigenvalue-panel').style.display = 'none';
        document.getElementById('vector-info-panel').style.display = 'none';
        document.getElementById('line-info-panel').style.display = 'none';
        this.eigenvaluePanelMatrixId = null;
        this.vectorInfoPanelId = null;
        this.lineInfoPanelId = null;
        
        // Clear invariant spaces when switching away from matrix panel
        this.invariantDisplayMode = 'off';
        this.clearInvariantSpaces();
        this.angleVisualizationState = null;
        this.clearAngleVisualization();
        
        // Toggle plane info panel for this plane
        if (this.planeInfoPanelId === id) {
            // Already showing this plane, hide panel
            this.planeInfoPanelId = null;
            this.angleVisualizationState = null;
            this.clearAngleVisualization();
        } else {
            // Show panel for this plane
            this.planeInfoPanelId = id;
            this.closePanelOnMobile();
        }
        
        // Update the plane info panel
        this.updatePlanePanel();
    }

    showVectorInfo(id) {
        const vec = this.vectors.find(v => v.id === id);
        if (!vec || !vec.visible) {
            if (this.vectorInfoPanelId === id) {
                this.vectorInfoPanelId = null;
            }
            document.getElementById('vector-info-panel').style.display = 'none';
            return;
        }

        // Hide other info panels
        document.getElementById('eigenvalue-panel').style.display = 'none';
        document.getElementById('line-info-panel').style.display = 'none';
        document.getElementById('plane-info-panel').style.display = 'none';
        this.eigenvaluePanelMatrixId = null;
        this.lineInfoPanelId = null;
        this.planeInfoPanelId = null;

        // Clear invariant spaces when switching away from matrix panel
        this.invariantDisplayMode = 'off';
        this.clearInvariantSpaces();

        // Toggle vector info panel for this vector
        if (this.vectorInfoPanelId === id) {
            this.vectorInfoPanelId = null;
        } else {
            this.vectorInfoPanelId = id;
            this.closePanelOnMobile();
        }

        this.angleVisualizationState = null;
        this.clearAngleVisualization();

        // Update the vector info panel
        this.updateVectorPanel();
    }


    clearVectors() {
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
            this.disposeVectorLabel(vec);
        });
        this.clearPresetEdges();
        this.vectors = [];
        
        // Update the dimension-specific storage
        if (this.dimension === '2d') {
            this.vectors2D = this.vectors;
        } else {
            this.vectors3D = this.vectors;
        }
        
        this.updateObjectsList();
        this.scheduleStateSave();
    }

    resetVectors() {
        this.vectors.forEach(vec => {
            const original = vec.originalEnd;
            vec.currentEnd.copy(original);
            
            const direction = original.clone().normalize();
            const length = original.length();
            
            this.scene.remove(vec.arrow);
            const thickness = this.getVectorArrowThickness();
            vec.arrow = this.createSmoothArrow(
                direction,
                new THREE.Vector3(0, 0, 0),
                length,
                vec.color,
                thickness.headLength,
                thickness.headWidth
            );
            
            // Update point sphere position
            if (vec.pointSphere) {
                vec.pointSphere.position.copy(original);
            }
        });
        
        // Rebuild visualization based on current mode
        this.updateVectorDisplay();
        this.updateVectorList();
    }

    getNextMatrixLetter() {
        const alphabet = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'; // Skip I
        for (let letter of alphabet) {
            if (!this.usedMatrixLetters.has(letter)) {
                return letter;
            }
        }
        // If all letters used, start doubling
        return 'A' + (this.matrices.length + 1);
    }

    addMatrix() {
        const name = this.getNextMatrixLetter();
        this.usedMatrixLetters.add(name);
        
        // Create identity matrix by default
        const size = this.dimension === '2d' ? 2 : 3;
        const values = [];
        for (let i = 0; i < size; i++) {
            values[i] = [];
            for (let j = 0; j < size; j++) {
                values[i][j] = i === j ? 1 : 0; // Identity matrix
            }
        }
        
        // Use consistent purple color for all matrices (not visual objects)
        const color = new THREE.Color(0x904AE2); // Purple
        
        const matrix = {
            id: this.nextMatrixId++,
            name: name,
            values: values,
            color: color
        };
        
        this.matrices.push(matrix);
        
        // Auto-select this newly added matrix
        this.selectedMatrixId = matrix.id;
        
        // Update dimension-specific storage
        if (this.dimension === '2d') {
            this.selectedMatrixId2D = this.selectedMatrixId;
        } else {
            this.selectedMatrixId3D = this.selectedMatrixId;
        }
        
        // Expand matrices group so user can see it was added
        this.groupCollapsed.matrices = false;
        
        // Only visualize invariant spaces if display mode is active and panel was showing
        // Otherwise, adding a new matrix shouldn't show eigenspaces automatically
        if (this.invariantDisplayMode !== 'off' && this.eigenvaluePanelMatrixId) {
            // Update the panel to show the new matrix
            this.eigenvaluePanelMatrixId = matrix.id;
            this.visualizeInvariantSpaces();
        }
        
        this.updateObjectsList();
        this.scheduleStateSave();
    }

    addPresetMatrix(preset) {
        const name = this.getNextMatrixLetter();
        this.usedMatrixLetters.add(name);
        
        const size = this.dimension === '2d' ? 2 : 3;
        let values = [];
        
        // Initialize values array
        for (let i = 0; i < size; i++) {
            values[i] = [];
            for (let j = 0; j < size; j++) {
                values[i][j] = 0;
            }
        }
        
        // Set values based on preset
        if (size === 2) {
            switch(preset) {
                case 'rotation-45':
                    const cos45 = Math.cos(Math.PI / 4);
                    const sin45 = Math.sin(Math.PI / 4);
                    values[0][0] = cos45; values[0][1] = -sin45;
                    values[1][0] = sin45; values[1][1] = cos45;
                    break;
                case 'rotation-90':
                    values[0][0] = 0; values[0][1] = -1;
                    values[1][0] = 1; values[1][1] = 0;
                    break;
                case 'scale-2x':
                    values[0][0] = 2; values[0][1] = 0;
                    values[1][0] = 0; values[1][1] = 2;
                    break;
                case 'shear-x':
                    values[0][0] = 1; values[0][1] = 1;
                    values[1][0] = 0; values[1][1] = 1;
                    break;
                case 'reflection-x':
                    values[0][0] = 1; values[0][1] = 0;
                    values[1][0] = 0; values[1][1] = -1;
                    break;
                case 'reflection-y':
                    values[0][0] = -1; values[0][1] = 0;
                    values[1][0] = 0; values[1][1] = 1;
                    break;
            }
        } else {
            // 3D presets
            switch(preset) {
                case 'rotation-45':
                    const cos45 = Math.cos(Math.PI / 4);
                    const sin45 = Math.sin(Math.PI / 4);
                    values[0][0] = cos45; values[0][1] = -sin45; values[0][2] = 0;
                    values[1][0] = sin45; values[1][1] = cos45; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 1;
                    break;
                case 'rotation-90':
                    values[0][0] = 0; values[0][1] = -1; values[0][2] = 0;
                    values[1][0] = 1; values[1][1] = 0; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 1;
                    break;
                case 'scale-2x':
                    values[0][0] = 2; values[0][1] = 0; values[0][2] = 0;
                    values[1][0] = 0; values[1][1] = 2; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 2;
                    break;
                case 'shear-x':
                    values[0][0] = 1; values[0][1] = 1; values[0][2] = 0;
                    values[1][0] = 0; values[1][1] = 1; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 1;
                    break;
                case 'reflection-x':
                    values[0][0] = 1; values[0][1] = 0; values[0][2] = 0;
                    values[1][0] = 0; values[1][1] = -1; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 1;
                    break;
                case 'reflection-y':
                    values[0][0] = -1; values[0][1] = 0; values[0][2] = 0;
                    values[1][0] = 0; values[1][1] = 1; values[1][2] = 0;
                    values[2][0] = 0; values[2][1] = 0; values[2][2] = 1;
                    break;
            }
        }
        
        const color = new THREE.Color(0x904AE2); // Purple
        
        const matrix = {
            id: this.nextMatrixId++,
            name: name,
            values: values,
            color: color
        };
        
        this.matrices.push(matrix);
        
        // Auto-select this newly added matrix
        this.selectedMatrixId = matrix.id;
        
        // Update dimension-specific storage
        if (this.dimension === '2d') {
            this.selectedMatrixId2D = this.selectedMatrixId;
        } else {
            this.selectedMatrixId3D = this.selectedMatrixId;
        }
        
        // Expand matrices group so user can see it was added
        this.groupCollapsed.matrices = false;
        
        // Only visualize invariant spaces if display mode is active and panel was showing
        // Otherwise, adding a new matrix shouldn't show eigenspaces automatically
        if (this.invariantDisplayMode !== 'off' && this.eigenvaluePanelMatrixId) {
            // Update the panel to show the new matrix
            this.eigenvaluePanelMatrixId = matrix.id;
            this.visualizeInvariantSpaces();
        }
        
        this.updateObjectsList();
        this.scheduleStateSave();
    }

    addPresetVectors(preset) {
        // Clear existing vectors first
        this.clearVectors();
        
        // Define preset vector coordinates
        let vectors = [];
        let edgeIndexPairs = [];
        let faceIndexTriples = [];
        
        switch(preset) {
            // 2D Presets
            case 'preset-square':
                // Unit square vertices
                vectors = [
                    [0, 0, 0],
                    [1, 0, 0],
                    [1, 1, 0],
                    [0, 1, 0]
                ];
                edgeIndexPairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
                break;
                
            case 'preset-triangle':
                // Equilateral triangle
                vectors = [
                    [0, 0, 0],
                    [1, 0, 0],
                    [0.5, 0.866, 0]
                ];
                edgeIndexPairs = [[0, 1], [1, 2], [2, 0]];
                break;
                
            case 'preset-pentagon':
                // Regular pentagon
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 2 * Math.PI / 5) - Math.PI / 2; // Start from top
                    vectors.push([Math.cos(angle), Math.sin(angle), 0]);
                }
                for (let i = 0; i < 5; i++) {
                    edgeIndexPairs.push([i, (i + 1) % 5]);
                }
                break;
                
            case 'preset-star':
                // 5-pointed star
                const outerRadius = 1;
                const innerRadius = 0.382; // Golden ratio for aesthetics
                for (let i = 0; i < 10; i++) {
                    const angle = (i * Math.PI / 5) - Math.PI / 2; // Start from top
                    const radius = i % 2 === 0 ? outerRadius : innerRadius;
                    vectors.push([radius * Math.cos(angle), radius * Math.sin(angle), 0]);
                }
                for (let i = 0; i < 10; i++) {
                    edgeIndexPairs.push([i, (i + 1) % 10]);
                }
                break;
                
            case 'preset-circle':
                // Circle approximation with 8 points
                for (let i = 0; i < 8; i++) {
                    const angle = (i * 2 * Math.PI / 8); // Start from right
                    vectors.push([Math.cos(angle), Math.sin(angle), 0]);
                }
                for (let i = 0; i < 8; i++) {
                    edgeIndexPairs.push([i, (i + 1) % 8]);
                }
                break;
                
            // 3D Presets
            case 'preset-cube':
                // Unit cube vertices (all 8 corners)
                vectors = [
                    [0, 0, 0],
                    [1, 0, 0],
                    [1, 1, 0],
                    [0, 1, 0],
                    [0, 0, 1],
                    [1, 0, 1],
                    [1, 1, 1],
                    [0, 1, 1]
                ];
                edgeIndexPairs = [
                    [0, 1], [1, 2], [2, 3], [3, 0],
                    [4, 5], [5, 6], [6, 7], [7, 4],
                    [0, 4], [1, 5], [2, 6], [3, 7]
                ];
                faceIndexTriples = [
                    [0, 1, 2], [0, 2, 3],
                    [4, 5, 6], [4, 6, 7],
                    [0, 1, 5], [0, 5, 4],
                    [1, 2, 6], [1, 6, 5],
                    [2, 3, 7], [2, 7, 6],
                    [3, 0, 4], [3, 4, 7]
                ];
                break;
                
            case 'preset-tetrahedron':
                // Regular tetrahedron (4 vertices forming a triangular pyramid)
                // Centered and oriented nicely
                const a = 1 / Math.sqrt(2);
                vectors = [
                    [1, 0, -a],
                    [-1, 0, -a],
                    [0, 1, a],
                    [0, -1, a]
                ];
                edgeIndexPairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
                faceIndexTriples = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
                break;
                
            case 'preset-octahedron':
                // Regular octahedron (6 vertices, like two pyramids)
                vectors = [
                    [1, 0, 0],
                    [-1, 0, 0],
                    [0, 1, 0],
                    [0, -1, 0],
                    [0, 0, 1],
                    [0, 0, -1]
                ];
                edgeIndexPairs = [
                    [0, 2], [0, 3], [0, 4], [0, 5],
                    [1, 2], [1, 3], [1, 4], [1, 5],
                    [2, 4], [2, 5], [3, 4], [3, 5]
                ];
                faceIndexTriples = [
                    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
                    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]
                ];
                break;
                
            case 'preset-sphere':
                // Sphere approximation with multiple rings at different latitudes
                const rings = 4; // Number of latitude rings
                const pointsPerRing = 6; // Points around each ring
                
                // Top pole
                vectors.push([0, 0, 1]);
                
                // Rings at different latitudes
                for (let ring = 1; ring < rings; ring++) {
                    const phi = (ring * Math.PI) / rings; // Latitude angle
                    const z = Math.cos(phi);
                    const ringRadius = Math.sin(phi);
                    
                    for (let i = 0; i < pointsPerRing; i++) {
                        const theta = (i * 2 * Math.PI) / pointsPerRing; // Longitude angle
                        vectors.push([
                            ringRadius * Math.cos(theta),
                            ringRadius * Math.sin(theta),
                            z
                        ]);
                    }
                }
                
                // Bottom pole
                vectors.push([0, 0, -1]);

                const topIndex = 0;
                const bottomIndex = vectors.length - 1;
                const ringStart = (ring) => 1 + (ring * pointsPerRing); // ring in [0..rings-2]

                // Connect top pole to first ring
                for (let i = 0; i < pointsPerRing; i++) {
                    edgeIndexPairs.push([topIndex, ringStart(0) + i]);
                }

                // Connect each ring in a loop
                for (let ring = 0; ring < rings - 1; ring++) {
                    const start = ringStart(ring);
                    for (let i = 0; i < pointsPerRing; i++) {
                        edgeIndexPairs.push([start + i, start + ((i + 1) % pointsPerRing)]);
                    }
                }

                // Connect neighboring rings by longitude
                for (let ring = 0; ring < rings - 2; ring++) {
                    const currentStart = ringStart(ring);
                    const nextStart = ringStart(ring + 1);
                    for (let i = 0; i < pointsPerRing; i++) {
                        edgeIndexPairs.push([currentStart + i, nextStart + i]);
                    }
                }

                // Connect last ring to bottom pole
                const lastRingStart = ringStart(rings - 2);
                for (let i = 0; i < pointsPerRing; i++) {
                    edgeIndexPairs.push([lastRingStart + i, bottomIndex]);
                }

                // Triangulate top cap
                for (let i = 0; i < pointsPerRing; i++) {
                    const next = (i + 1) % pointsPerRing;
                    faceIndexTriples.push([topIndex, ringStart(0) + i, ringStart(0) + next]);
                }

                // Triangulate between neighboring rings
                for (let ring = 0; ring < rings - 2; ring++) {
                    const currentStart = ringStart(ring);
                    const nextStart = ringStart(ring + 1);
                    for (let i = 0; i < pointsPerRing; i++) {
                        const next = (i + 1) % pointsPerRing;
                        const a = currentStart + i;
                        const b = currentStart + next;
                        const c = nextStart + i;
                        const d = nextStart + next;
                        faceIndexTriples.push([a, c, b]);
                        faceIndexTriples.push([b, c, d]);
                    }
                }

                // Triangulate bottom cap
                for (let i = 0; i < pointsPerRing; i++) {
                    const next = (i + 1) % pointsPerRing;
                    faceIndexTriples.push([bottomIndex, lastRingStart + next, lastRingStart + i]);
                }
                break;
        }
        
        // Add all vectors and remember IDs for hidden preset edges
        const addedVectors = vectors.map(v => this.addVector(v[0], v[1], v[2]));

        const presetEdges = edgeIndexPairs.map(([startIndex, endIndex]) => ({
            startId: addedVectors[startIndex].id,
            endId: addedVectors[endIndex].id
        }));

        const presetFaces = faceIndexTriples.map(([aIndex, bIndex, cIndex]) => ({
            aId: addedVectors[aIndex].id,
            bId: addedVectors[bIndex].id,
            cId: addedVectors[cIndex].id
        }));

        this.presetEdges.length = 0;
        this.presetEdges.push(...presetEdges);
        this.presetFaces.length = 0;
        this.presetFaces.push(...presetFaces);

        this.updateVectorDisplay();
        this.scheduleStateSave();
    }

    removeMatrix(id) {
        const index = this.matrices.findIndex(m => m.id === id);
        
        if (index !== -1) {
            const matrix = this.matrices[index];
            this.usedMatrixLetters.delete(matrix.name);
            this.matrices.splice(index, 1);
            
            // If this was the selected matrix, select the first one or null
            if (this.selectedMatrixId === id) {
                this.selectedMatrixId = this.matrices.length > 0 ? this.matrices[0].id : null;
                
                // Update dimension-specific storage
                if (this.dimension === '2d') {
                    this.selectedMatrixId2D = this.selectedMatrixId;
                } else {
                    this.selectedMatrixId3D = this.selectedMatrixId;
                }
                
                // Reset invariant display mode and clear spaces
                this.invariantDisplayMode = 'off';
                this.clearInvariantSpaces();
                
                // Hide eigenvalue panel
                const panel = document.getElementById('eigenvalue-panel');
                if (panel) panel.style.display = 'none';
                this.eigenvaluePanelMatrixId = null;
            }
            
            this.updateObjectsList();
            this.scheduleStateSave();
        }
    }

    getMatrixById(id) {
        return this.matrices.find(m => m.id === id);
    }

    closePanelOnMobile() {
        if (window.innerWidth >= 768 || !this.panelOpen) {
            return;
        }

        const controlPanel = document.querySelector('.control-panel');
        const panelToggleBtn = document.getElementById('panel-toggle-btn');

        if (!controlPanel || !panelToggleBtn) {
            return;
        }

        this.panelOpen = false;
        controlPanel.classList.add('closed');
        panelToggleBtn.classList.remove('active');

        setTimeout(() => {
            requestAnimationFrame(() => {
                this.onPanelResize();
            });
        }, 300);
    }

    animateTransformation(matrixId = null) {
        if (this.isAnimating || (this.vectors.length === 0 && this.lines.length === 0 && this.planes.length === 0)) return;
        
        // Auto-close panel on mobile/narrow screens to see the animation
        this.closePanelOnMobile();
        
        // Clear any existing visualizations before starting
        this.updateVectorDisplay();
        
        // Get matrix to apply
        const targetMatrixId = matrixId || this.selectedMatrixId;
        if (!targetMatrixId) {
            alert('Please specify a matrix to apply');
            return;
        }
        
        const selectedMatrix = this.getMatrixById(targetMatrixId);
        if (!selectedMatrix) {
            alert('Matrix not found');
            return;
        }
        
        // Convert matrix values to THREE.Matrix3
        const matrix = new THREE.Matrix3();
        let matrix4; // For 3D transformations and plane transformations
        if (this.dimension === '2d') {
            matrix.set(
                selectedMatrix.values[0][0], selectedMatrix.values[0][1], 0,
                selectedMatrix.values[1][0], selectedMatrix.values[1][1], 0,
                0, 0, 1
            );
        } else {
            matrix.set(
                selectedMatrix.values[0][0], selectedMatrix.values[0][1], selectedMatrix.values[0][2],
                selectedMatrix.values[1][0], selectedMatrix.values[1][1], selectedMatrix.values[1][2],
                selectedMatrix.values[2][0], selectedMatrix.values[2][1], selectedMatrix.values[2][2]
            );
            // Also create Matrix4 for plane transformations
            matrix4 = new THREE.Matrix4().setFromMatrix3(matrix);
        }

        const useRotationInterpolation3D = this.dimension === '3d' && this.isProperRotationMatrix3(matrix);
        const targetRotationQuaternion = useRotationInterpolation3D
            ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(matrix))
            : null;

        const useRotationInterpolation2D = this.dimension === '2d' && this.isProperRotationMatrix2(matrix);
        const targetRotationAngle2D = useRotationInterpolation2D
            ? Math.atan2(matrix.elements[1], matrix.elements[0])
            : null;

        this.isAnimating = true;
        const duration = this.animationSpeed * 1000;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = this.easeInOutCubic(progress);

            const interpolatedTransform = this.buildInterpolatedTransform(
                matrix,
                eased,
                useRotationInterpolation3D,
                targetRotationQuaternion,
                useRotationInterpolation2D,
                targetRotationAngle2D
            );
            const interpolatedMatrix = interpolatedTransform.matrix3;
            const interpolatedMatrix4 = interpolatedTransform.matrix4;

            this.vectors.forEach(vec => {
                const original = vec.originalEnd.clone();

                const current = original.clone().applyMatrix3(interpolatedMatrix);
                
                vec.currentEnd.copy(current);

                // Update arrow
                const direction = current.clone().normalize();
                const length = current.length();
                
                // Remove old arrow from scene first
                if (vec.arrow) {
                    this.scene.remove(vec.arrow);
                }
                
                const thickness = this.getVectorArrowThickness();
                vec.arrow = this.createSmoothArrow(
                    direction,
                    new THREE.Vector3(0, 0, 0),
                    length,
                    vec.color,
                    thickness.headLength,
                    thickness.headWidth
                );
                
                // Update point sphere position
                if (vec.pointSphere) {
                    vec.pointSphere.position.copy(current);
                }
            });

            // Update visualization based on current mode
            this.updateVectorDisplay();

            // Transform lines
            this.lines.forEach(line => {
                // Transform point and direction
                const originalPoint = new THREE.Vector3(line.originalPoint.x, line.originalPoint.y, line.originalPoint.z);
                const originalDirection = new THREE.Vector3(line.originalDirection.x, line.originalDirection.y, line.originalDirection.z);

                // Transform point and direction
                const transformedPoint = originalPoint.clone().applyMatrix3(interpolatedMatrix);
                const transformedDirection = originalDirection.clone().applyMatrix3(interpolatedMatrix);
                
                // Update current values
                line.currentPoint.x = transformedPoint.x;
                line.currentPoint.y = transformedPoint.y;
                line.currentPoint.z = transformedPoint.z;
                line.currentDirection.x = transformedDirection.x;
                line.currentDirection.y = transformedDirection.y;
                line.currentDirection.z = transformedDirection.z;
                
                // Re-render line with transformed values
                this.renderLine(line);
            });

            // Transform planes (only in 3D)
            if (this.dimension === '3d' && matrix4) {
                this.planes.forEach(plane => {
                    // For plane transformations, we need the inverse transpose of the transformation matrix
                    const originalNormal = new THREE.Vector3(plane.originalA, plane.originalB, plane.originalC);
                    const originalD = plane.originalD;
                    
                    // Get inverse transpose for normal transformation
                    const inverseTranspose = interpolatedMatrix4.clone().invert().transpose();
                    
                    // Transform the normal vector (a, b, c)
                    const transformedNormal = originalNormal.clone().applyMatrix4(inverseTranspose);
                    
                    // For the d component, we need to consider how the transformation affects distance
                    // Simple approach: transform a point on the original plane and recalculate d
                    let transformedD = originalD;
                    if (originalNormal.length() > 0) {
                        // Find a point on the original plane
                        const originalNormalNorm = originalNormal.clone().normalize();
                        const pointOnOriginalPlane = originalNormalNorm.clone().multiplyScalar(-originalD);
                        
                        // Transform this point
                        const transformedPoint = pointOnOriginalPlane.clone().applyMatrix4(interpolatedMatrix4);
                        
                        // Recalculate d using the transformed point and normal
                        const transformedNormalNorm = transformedNormal.clone().normalize();
                        transformedD = -transformedPoint.dot(transformedNormalNorm);
                    }
                    
                    // Update current values
                    plane.currentA = transformedNormal.x;
                    plane.currentB = transformedNormal.y;
                    plane.currentC = transformedNormal.z;
                    plane.currentD = transformedD;
                    
                    // Re-render plane with transformed values
                    this.renderPlane(plane);
                });
            }

            // Update intersections in real-time during animation
            this.updateIntersections();

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.isAnimating = false;
                
                // Update original positions to transformed positions
                this.vectors.forEach(vec => {
                    vec.originalEnd.copy(vec.currentEnd);
                });
                
                // Update original line positions/directions to transformed values
                this.lines.forEach(line => {
                    line.originalPoint.x = line.currentPoint.x;
                    line.originalPoint.y = line.currentPoint.y;
                    line.originalPoint.z = line.currentPoint.z;
                    line.originalDirection.x = line.currentDirection.x;
                    line.originalDirection.y = line.currentDirection.y;
                    line.originalDirection.z = line.currentDirection.z;
                    
                    // Update main point/direction references
                    line.point.x = line.currentPoint.x;
                    line.point.y = line.currentPoint.y;
                    line.point.z = line.currentPoint.z;
                    line.direction.x = line.currentDirection.x;
                    line.direction.y = line.currentDirection.y;
                    line.direction.z = line.currentDirection.z;
                });
                
                // Update original plane coefficients to transformed values
                this.planes.forEach(plane => {
                    plane.originalA = plane.currentA;
                    plane.originalB = plane.currentB;
                    plane.originalC = plane.currentC;
                    plane.originalD = plane.currentD;
                    
                    // Update main coefficient references
                    plane.a = plane.currentA;
                    plane.b = plane.currentB;
                    plane.c = plane.currentC;
                    plane.d = plane.currentD;
                });
                
                // Final update of objects list and intersections
                this.updateObjectsList();
                this.updateIntersections();
                this.scheduleStateSave();
            }
        };

        animate();
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    isProperRotationMatrix3(matrix) {
        const m = matrix.elements;

        const xAxis = new THREE.Vector3(m[0], m[1], m[2]);
        const yAxis = new THREE.Vector3(m[3], m[4], m[5]);
        const zAxis = new THREE.Vector3(m[6], m[7], m[8]);

        const epsilon = 1e-3;

        const hasUnitAxes =
            Math.abs(xAxis.length() - 1) < epsilon &&
            Math.abs(yAxis.length() - 1) < epsilon &&
            Math.abs(zAxis.length() - 1) < epsilon;

        const hasOrthogonalAxes =
            Math.abs(xAxis.dot(yAxis)) < epsilon &&
            Math.abs(xAxis.dot(zAxis)) < epsilon &&
            Math.abs(yAxis.dot(zAxis)) < epsilon;

        const determinant = new THREE.Matrix4().setFromMatrix3(matrix).determinant();
        const hasPositiveUnitDet = Math.abs(determinant - 1) < epsilon;

        return hasUnitAxes && hasOrthogonalAxes && hasPositiveUnitDet;
    }

    isProperRotationMatrix2(matrix) {
        const m = matrix.elements;
        const a = m[0];
        const c = m[1];
        const b = m[3];
        const d = m[4];

        const xAxis = new THREE.Vector2(a, c);
        const yAxis = new THREE.Vector2(b, d);
        const epsilon = 1e-3;

        const hasUnitAxes =
            Math.abs(xAxis.length() - 1) < epsilon &&
            Math.abs(yAxis.length() - 1) < epsilon;

        const hasOrthogonalAxes = Math.abs(xAxis.dot(yAxis)) < epsilon;
        const determinant = a * d - b * c;
        const hasPositiveUnitDet = Math.abs(determinant - 1) < epsilon;

        return hasUnitAxes && hasOrthogonalAxes && hasPositiveUnitDet;
    }

    buildInterpolatedTransform(matrix, eased, useRotationInterpolation3D, targetRotationQuaternion, useRotationInterpolation2D, targetRotationAngle2D) {
        if (useRotationInterpolation2D && typeof targetRotationAngle2D === 'number') {
            const angle = targetRotationAngle2D * eased;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            const matrix3 = new THREE.Matrix3().set(
                cos, -sin, 0,
                sin,  cos, 0,
                0,    0,   1
            );

            return {
                matrix3,
                matrix4: new THREE.Matrix4().setFromMatrix3(matrix3)
            };
        }

        if (useRotationInterpolation3D && targetRotationQuaternion) {
            const identityQuaternion = new THREE.Quaternion();
            const interpolatedQuaternion = new THREE.Quaternion();
            interpolatedQuaternion.slerpQuaternions(identityQuaternion, targetRotationQuaternion, eased);

            const matrix4 = new THREE.Matrix4().makeRotationFromQuaternion(interpolatedQuaternion);
            const matrix3 = new THREE.Matrix3().setFromMatrix4(matrix4);
            return { matrix3, matrix4 };
        }

        const identityMatrix = new THREE.Matrix3().identity();
        const interpolatedMatrix = new THREE.Matrix3();

        for (let i = 0; i < 9; i++) {
            interpolatedMatrix.elements[i] =
                identityMatrix.elements[i] * (1 - eased) +
                matrix.elements[i] * eased;
        }

        return {
            matrix3: interpolatedMatrix,
            matrix4: new THREE.Matrix4().setFromMatrix3(interpolatedMatrix)
        };
    }

    // Line and Plane Functions
    getNextIndexedName(prefix, items) {
        const usedNumbers = new Set();
        const pattern = new RegExp(`^${prefix}(\\d+)$`);

        items.forEach(item => {
            if (!item || typeof item.name !== 'string') return;
            const match = item.name.match(pattern);
            if (!match) return;

            const number = parseInt(match[1], 10);
            if (!Number.isNaN(number) && number > 0) {
                usedNumbers.add(number);
            }
        });

        let candidate = 1;
        while (usedNumbers.has(candidate)) {
            candidate++;
        }

        return `${prefix}${candidate}`;
    }

    getColorDistance(hexA, hexB) {
        const colorA = new THREE.Color(hexA);
        const colorB = new THREE.Color(hexB);

        const dr = (colorA.r - colorB.r) * 255;
        const dg = (colorA.g - colorB.g) * 255;
        const db = (colorA.b - colorB.b) * 255;

        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    getNextDistinctObjectColor(previousColorHex = null) {
        const palette = this.vectorColors;
        if (!palette || palette.length === 0) return '#4A90E2';

        const startIndex = this.colorIndex;
        const minimumDistance = 120;

        for (let offset = 0; offset < palette.length; offset++) {
            const paletteIndex = (startIndex + offset) % palette.length;
            const candidate = palette[paletteIndex];

            if (!previousColorHex || this.getColorDistance(candidate, previousColorHex) >= minimumDistance) {
                this.colorIndex = paletteIndex + 1;
                return candidate;
            }
        }

        const fallbackIndex = startIndex % palette.length;
        const fallback = palette[fallbackIndex];
        this.colorIndex = fallbackIndex + 1;
        return fallback;
    }

    addLine(ax = 0, ay = 1, az = 0, bx = 1, by = 0, bz = 0) {
        const previousLineColor = this.lines.length > 0 ? this.lines[this.lines.length - 1].color : null;
        const colorHex = this.getNextDistinctObjectColor(previousLineColor);
        
        const line = {
            id: this.nextLineId++,
            name: this.getNextIndexedName('L', this.lines),
            point: { x: ax, y: ay, z: az },
            direction: { x: bx, y: by, z: bz },
            originalPoint: { x: ax, y: ay, z: az },
            originalDirection: { x: bx, y: by, z: bz },
            currentPoint: { x: ax, y: ay, z: az },
            currentDirection: { x: bx, y: by, z: bz },
            color: colorHex,
            visible: true,
            mesh: null,
            formPreference: 'parametric' // 'parametric', 'cross', or 'cartesian'
        };
        
        this.lines.push(line);
        
        // Expand lines group so user can see it was added
        this.groupCollapsed.lines = false;
        
        this.renderLine(line);
        this.updateObjectsList();
        this.updateIntersections();
        this.scheduleStateSave();
        return line;
    }

    addPlane(a = 0, b = 0, c = 1, d = 0) {
        if (this.dimension === '2d') return;
        
        const previousPlaneColor = this.planes.length > 0 ? this.planes[this.planes.length - 1].color : null;
        const colorHex = this.getNextDistinctObjectColor(previousPlaneColor);
        
        const plane = {
            id: this.nextPlaneId++,
            name: this.getNextIndexedName('P', this.planes),
            a, b, c, d,
            originalA: a, originalB: b, originalC: c, originalD: d,
            currentA: a, currentB: b, currentC: c, currentD: d,
            color: colorHex,
            visible: true,
            mesh: null,
            formPreference: 'dot' // 'cartesian', 'vector', 'scalar', or 'dot'
        };
        
        this.planes.push(plane);
        
        // Expand planes group so user can see it was added
        this.groupCollapsed.planes = false;
        
        this.renderPlane(plane);
        this.updateObjectsList();
        this.updateIntersections();
        this.scheduleStateSave();
        return plane;
    }

    renderLine(line) {
        // Remove existing mesh if any
        if (line.mesh) {
            this.scene.remove(line.mesh);
        }

        const tMin = -100;
        const tMax = 100;
        
        // Calculate start and end points using current values (for animation support)
        const currentPoint = line.currentPoint || line.point;
        const currentDirection = line.currentDirection || line.direction;
        const start = new THREE.Vector3(
            currentPoint.x + tMin * currentDirection.x,
            currentPoint.y + tMin * currentDirection.y,
            currentPoint.z + tMin * currentDirection.z
        );
        
        const end = new THREE.Vector3(
            currentPoint.x + tMax * currentDirection.x,
            currentPoint.y + tMax * currentDirection.y,
            currentPoint.z + tMax * currentDirection.z
        );
        
        // Use cylinder for visible thickness (same approach as axes)
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.2; // Slightly thicker than path lines
        const radialSegments = this.dimension === '2d' ? 3 : 16;
        
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        direction.normalize();
        
        const geometry = new THREE.CylinderGeometry(
            lineRadius,
            lineRadius,
            length,
            radialSegments,
            1,
            false
        );
        
        const material = new THREE.MeshBasicMaterial({ 
            color: new THREE.Color(line.color),
            depthWrite: true,
            depthTest: true
        });
        
        line.mesh = new THREE.Mesh(geometry, material);
        
        // Position at midpoint
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        line.mesh.position.copy(midpoint);
        
        // Orient along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
        line.mesh.quaternion.copy(quaternion);
        
        line.mesh.visible = line.visible;
        this.scene.add(line.mesh);

        if (!this.isAnimating && !this.isInteracting) {
            this.scheduleStateSave();
        }
    }

    renderPlane(plane) {
        if (this.dimension === '2d') return;
        
        // Remove existing mesh if any
        if (plane.mesh) {
            this.scene.remove(plane.mesh);
        }

        const extent = Math.max(5, Math.min(100, this.toFiniteNumber(this.planeExtent, 10)));
        const geometry = new THREE.PlaneGeometry(extent * 2, extent * 2);
        const material = new THREE.MeshBasicMaterial({ 
            color: new THREE.Color(plane.color),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        plane.mesh = new THREE.Mesh(geometry, material);

        // Position and orient based on equation ax + by + cz = d using current values (for animation support)
        // Fall back to main values if current values are not set
        const a = plane.currentA !== undefined ? plane.currentA : plane.a;
        const b = plane.currentB !== undefined ? plane.currentB : plane.b;
        const c = plane.currentC !== undefined ? plane.currentC : plane.c;
        const d = plane.currentD !== undefined ? plane.currentD : plane.d;
        if (a === 0 && b === 0 && c === 0) return; // Invalid plane
        
        const normal = new THREE.Vector3(a, b, c).normalize();
        const distance = d / Math.sqrt(a * a + b * b + c * c);
        
        plane.mesh.position.copy(normal.clone().multiplyScalar(distance));
        plane.mesh.lookAt(plane.mesh.position.clone().add(normal));
        plane.mesh.visible = plane.visible;
        this.scene.add(plane.mesh);

        if (!this.isAnimating && !this.isInteracting) {
            this.scheduleStateSave();
        }
    }

    onWindowResize() {
        // Debounce rapid resize events
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        
        this.isResizing = true;
        
        // Get dimensions from the container, not the canvas (canvas may not have updated yet)
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        
        // Directly force updates by recalculating axis lengths
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = width / height;
        const visibleHeight = 2 * distanceToTarget * Math.tan(fov / 2);
        const visibleWidth = visibleHeight * aspect;
        
        if (this.dimension === '2d') {
            this.axisLengthX = visibleWidth * 2.0;
            this.axisLengthY = visibleHeight * 2.0;
            this.axisLengthZ = Math.min(visibleWidth, visibleHeight) * 2.0;
        } else {
            const minDim = Math.min(visibleWidth, visibleHeight);
            this.axisLengthX = minDim;
            this.axisLengthY = minDim;
            this.axisLengthZ = minDim;
        }
        
        // Force redraw
        this.createAxes();
        this.createGrid();
        
        // Reset flag after a short delay
        this.resizeTimeout = setTimeout(() => {
            this.isResizing = false;
            this.resizeTimeout = null;
        }, 200);
    }

    onPanelResize() {
        // Lightweight resize for panel toggle - only update camera/renderer, not axes/grid
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    updateAxesLength() {
        // Skip if currently resizing - let resize handler manage axes
        if (this.isResizing) return;
        
        // Throttle updates to prevent constant recreation during zoom
        const now = Date.now();
        if (now - this.lastUpdateTime < 150) return; // Only update every 150ms max
        
        // Calculate visible viewport dimensions based on camera distance to target (zoom level)
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const fov = this.camera.fov * Math.PI / 180; // Convert to radians
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        
        // Calculate visible height and width at camera distance
        const visibleHeight = 2 * distanceToTarget * Math.tan(fov / 2);
        const visibleWidth = visibleHeight * aspect;
        
        // Axes should extend far beyond viewport so they're always visible when panning
        let newLengthX, newLengthY, newLengthZ;
        
        if (this.dimension === '2d') {
            // In 2D, make axes extend well beyond viewport edges for panning
            newLengthX = visibleWidth * 2.0;
            newLengthY = visibleHeight * 2.0;
            newLengthZ = Math.min(visibleWidth, visibleHeight) * 2.0;
        } else {
            // In 3D, axes are rendered at fixed length (100), but we still track viewport dims
            const minDim = Math.min(visibleWidth, visibleHeight);
            newLengthX = minDim;
            newLengthY = minDim;
            newLengthZ = minDim;
        }
        
        // Only recreate axes if any length changed significantly (>5% change to reduce updates)
        // Handle case when old values are 0 or very small
        const changeX = this.axisLengthX > 0.01 ? Math.abs(newLengthX - this.axisLengthX) / this.axisLengthX : 1;
        const changeY = this.axisLengthY > 0.01 ? Math.abs(newLengthY - this.axisLengthY) / this.axisLengthY : 1;
        const changeZ = this.axisLengthZ > 0.01 ? Math.abs(newLengthZ - this.axisLengthZ) / this.axisLengthZ : 1;
        const maxChange = Math.max(changeX, changeY, changeZ);
        
        if (maxChange > 0.05) {
            this.lastUpdateTime = now;
            this.axisLengthX = newLengthX;
            this.axisLengthY = newLengthY;
            this.axisLengthZ = newLengthZ;
            this.createAxes();
            
            // Also update vector thickness when camera distance changes
            this.updateVectorThickness();
            this.updateInvariantLineThickness();
            this.updateLineThickness();
            this.updateIntersections();
            this.lastCameraDistance = distanceToTarget;
        }
    }

    updateVectorThickness(force = false) {
        // Recreate all vectors with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation
        
        // Throttle updates - only update if camera distance changed significantly
        const currentDistance = this.camera.position.distanceTo(this.controls.target);
        const distanceChange = Math.abs(currentDistance - this.lastCameraDistance);
        const relativeChange = this.lastCameraDistance > 0 ? distanceChange / this.lastCameraDistance : 1;
        
        // Only update if distance changed by more than 10%
        if (!force && relativeChange < 0.1) return;
        
        this.lastCameraDistance = currentDistance;
        
        this.vectors.forEach(vec => {
            const direction = vec.currentEnd.clone().normalize();
            const length = vec.currentEnd.length();
            
            // Remove old arrow from scene
            if (vec.arrow) {
                this.scene.remove(vec.arrow);
            }
            
            const thickness = this.getVectorArrowThickness();
            vec.arrow = this.createSmoothArrow(
                direction,
                new THREE.Vector3(0, 0, 0),
                length,
                vec.color,
                thickness.headLength,
                thickness.headWidth
            );
        });
        
        // Update visualization based on current mode
        this.updateVectorDisplay();
    }

    updateInvariantLineThickness() {
        // Recreate all invariant lines with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation

        const lineRadius = this.getInvariantLineRadius();
        const lineLength = 200;
        
        this.invariantLines.forEach(lineObj => {
            const direction = lineObj.direction;
            
            // Remove old mesh
            this.scene.remove(lineObj.mesh);
            
            // Create new cylinder with updated thickness
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            
            // Preserve the material properties including textures
            const oldMaterial = lineObj.mesh.material;
            const materialProps = {
                transparent: true,
                opacity: oldMaterial.opacity,
                depthTest: oldMaterial.depthTest,
                depthWrite: oldMaterial.depthWrite,
                polygonOffset: oldMaterial.polygonOffset,
                polygonOffsetFactor: oldMaterial.polygonOffsetFactor,
                polygonOffsetUnits: oldMaterial.polygonOffsetUnits
            };
            
            // Preserve texture if it exists (for solid mode)
            if (oldMaterial.map) {
                materialProps.map = oldMaterial.map;
            } else {
                materialProps.color = oldMaterial.color;
            }
            
            const material = new THREE.MeshBasicMaterial(materialProps);

            if (this.dimension === '3d') {
                material.depthTest = true;
                material.depthWrite = true;
                material.polygonOffset = false;
                material.polygonOffsetFactor = 0;
                material.polygonOffsetUnits = 0;
            }
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the direction
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines stay below vectors in 2D, while remaining above axes
            cylinder.renderOrder = this.getInvariantLineRenderOrder();
            
            this.scene.add(cylinder);
            
            // Update the reference
            lineObj.mesh = cylinder;
        });
    }

    updateLineThickness() {
        // Recreate all user-created lines with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation
        
        this.lines.forEach(line => {
            this.renderLine(line);
        });
    }

    calculateLinePlaneIntersection(line, plane) {
        // Line: r = point + t * direction
        // Plane: a*x + b*y + c*z = d
        
        // Use current animated values if available, otherwise use main values
        const a = plane.currentA !== undefined ? plane.currentA : plane.a;
        const b = plane.currentB !== undefined ? plane.currentB : plane.b;
        const c = plane.currentC !== undefined ? plane.currentC : plane.c;
        const d = plane.currentD !== undefined ? plane.currentD : plane.d;
        
        const currentPoint = line.currentPoint || line.point;
        const currentDirection = line.currentDirection || line.direction;
        
        // Calculate dot product: n · direction
        const denominator = a * currentDirection.x + b * currentDirection.y + c * currentDirection.z;
        
        // If denominator is 0, line is parallel to plane (no intersection or infinite intersections)
        if (Math.abs(denominator) < 0.0001) {
            return null;
        }
        
        // Calculate t: t = (d - n · point) / (n · direction)
        const numerator = d - (a * currentPoint.x + b * currentPoint.y + c * currentPoint.z);
        const t = numerator / denominator;
        
        // Calculate intersection point
        const intersection = new THREE.Vector3(
            currentPoint.x + t * currentDirection.x,
            currentPoint.y + t * currentDirection.y,
            currentPoint.z + t * currentDirection.z
        );
        
        return intersection;
    }

    calculatePlanePlaneIntersection(plane1, plane2) {
        // Two planes: a1*x + b1*y + c1*z = d1 and a2*x + b2*y + c2*z = d2
        // Intersection is a line (if planes are not parallel)
        
        // Use current animated values if available, otherwise use main values
        const a1 = plane1.currentA !== undefined ? plane1.currentA : plane1.a;
        const b1 = plane1.currentB !== undefined ? plane1.currentB : plane1.b;
        const c1 = plane1.currentC !== undefined ? plane1.currentC : plane1.c;
        const d1 = plane1.currentD !== undefined ? plane1.currentD : plane1.d;
        
        const a2 = plane2.currentA !== undefined ? plane2.currentA : plane2.a;
        const b2 = plane2.currentB !== undefined ? plane2.currentB : plane2.b;
        const c2 = plane2.currentC !== undefined ? plane2.currentC : plane2.c;
        const d2 = plane2.currentD !== undefined ? plane2.currentD : plane2.d;
        
        const n1 = new THREE.Vector3(a1, b1, c1);
        const n2 = new THREE.Vector3(a2, b2, c2);
        
        // Direction of intersection line is cross product of normals
        const direction = new THREE.Vector3().crossVectors(n1, n2);
        
        // If cross product is zero, planes are parallel
        if (direction.length() < 0.0001) {
            return null;
        }
        
        direction.normalize();
        
        // Find a point on the line by solving the system
        // We need to find one point that satisfies both plane equations
        // Use the coordinate with largest component in direction as free variable (set to 0)
        
        const absDir = new THREE.Vector3(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
        let point = new THREE.Vector3();
        
        // Choose which coordinate to set to 0 based on direction
        if (absDir.z >= absDir.x && absDir.z >= absDir.y) {
            // Set z = 0, solve for x and y
            const det = a1 * b2 - a2 * b1;
            if (Math.abs(det) < 0.0001) return null;
            point.x = (d1 * b2 - d2 * b1) / det;
            point.y = (a1 * d2 - a2 * d1) / det;
            point.z = 0;
        } else if (absDir.y >= absDir.x && absDir.y >= absDir.z) {
            // Set y = 0, solve for x and z
            const det = a1 * c2 - a2 * c1;
            if (Math.abs(det) < 0.0001) return null;
            point.x = (d1 * c2 - d2 * c1) / det;
            point.y = 0;
            point.z = (a1 * d2 - a2 * d1) / det;
        } else {
            // Set x = 0, solve for y and z
            const det = b1 * c2 - b2 * c1;
            if (Math.abs(det) < 0.0001) return null;
            point.x = 0;
            point.y = (d1 * c2 - d2 * c1) / det;
            point.z = (b1 * d2 - b2 * d1) / det;
        }
        
        return { point, direction };
    }

    calculateLineLineIntersection(line1, line2) {
        // Two lines: r1 = p1 + s*d1 and r2 = p2 + t*d2
        // They intersect if we can find s and t such that p1 + s*d1 = p2 + t*d2
        
        // Use current animated values if available, otherwise use main values
        const currentPoint1 = line1.currentPoint || line1.point;
        const currentDirection1 = line1.currentDirection || line1.direction;
        const currentPoint2 = line2.currentPoint || line2.point;
        const currentDirection2 = line2.currentDirection || line2.direction;
        
        const p1 = new THREE.Vector3(currentPoint1.x, currentPoint1.y, currentPoint1.z);
        const d1 = new THREE.Vector3(currentDirection1.x, currentDirection1.y, currentDirection1.z).normalize();
        const p2 = new THREE.Vector3(currentPoint2.x, currentPoint2.y, currentPoint2.z);
        const d2 = new THREE.Vector3(currentDirection2.x, currentDirection2.y, currentDirection2.z).normalize();
        
        // Calculate cross product of directions
        const crossD1D2 = new THREE.Vector3().crossVectors(d1, d2);
        const crossLengthSq = crossD1D2.lengthSq();
        
        // If cross product is zero, lines are parallel
        if (crossLengthSq < 0.0001) {
            return null;
        }
        
        // Vector from p1 to p2
        const p1ToP2 = new THREE.Vector3().subVectors(p2, p1);
        
        // Check if lines intersect (not skew)
        // Lines intersect if (p2 - p1) · (d1 × d2) = 0
        const dotProduct = p1ToP2.dot(crossD1D2);
        
        if (Math.abs(dotProduct) > 0.01) {
            // Lines are skew (don't intersect)
            return null;
        }
        
        // Calculate parameter s for line1
        // s = ((p2 - p1) × d2) · (d1 × d2) / |d1 × d2|^2
        const crossP1ToP2D2 = new THREE.Vector3().crossVectors(p1ToP2, d2);
        const s = crossP1ToP2D2.dot(crossD1D2) / crossLengthSq;
        
        // Calculate intersection point
        const intersection = new THREE.Vector3(
            p1.x + s * d1.x,
            p1.y + s * d1.y,
            p1.z + s * d1.z
        );
        
        return intersection;
    }

    classifyLineRelationship(line1, line2) {
        const currentPoint1 = line1.currentPoint || line1.point;
        const currentDirection1 = line1.currentDirection || line1.direction;
        const currentPoint2 = line2.currentPoint || line2.point;
        const currentDirection2 = line2.currentDirection || line2.direction;

        const p1 = new THREE.Vector3(currentPoint1.x, currentPoint1.y, currentPoint1.z);
        const d1 = new THREE.Vector3(currentDirection1.x, currentDirection1.y, currentDirection1.z).normalize();
        const p2 = new THREE.Vector3(currentPoint2.x, currentPoint2.y, currentPoint2.z);
        const d2 = new THREE.Vector3(currentDirection2.x, currentDirection2.y, currentDirection2.z).normalize();

        const crossD1D2 = new THREE.Vector3().crossVectors(d1, d2);
        if (crossD1D2.lengthSq() < 0.0001) {
            return 'parallel';
        }

        const p1ToP2 = new THREE.Vector3().subVectors(p2, p1);
        const dotProduct = p1ToP2.dot(crossD1D2);
        if (Math.abs(dotProduct) > 0.01) {
            return 'skew';
        }

        return 'intersecting';
    }

    createIntersectionLabel(point) {
        // Format coordinates for display
        const x = Math.abs(point.x) < 0.01 ? 0 : parseFloat(point.x.toFixed(2));
        const y = Math.abs(point.y) < 0.01 ? 0 : parseFloat(point.y.toFixed(2));
        const z = Math.abs(point.z) < 0.01 ? 0 : parseFloat(point.z.toFixed(2));
        
        // In 2D mode, only show x and y coordinates
        const text = this.dimension === '2d' ? `(${x}, ${y})` : `(${x}, ${y}, ${z})`;
        
        // Create canvas for the text
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        
        // Clear background
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 60px Arial';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(text, 10, 64);
        
        // Create sprite from canvas
        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.renderOrder = 1000; // Render on top
        
        // Scale based on camera distance
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = distanceToTarget * 0.05;
        sprite.scale.set(scale * 4, scale, 1);
        
        return sprite;
    }

    computeGcd(a, b) {
        let x = Math.abs(a);
        let y = Math.abs(b);

        while (y !== 0) {
            const temp = y;
            y = x % y;
            x = temp;
        }

        return x;
    }

    reduceIntegerTriple(x, y, z) {
        const values = [x, y, z].map(v => Math.round(v));
        const absValues = values.map(v => Math.abs(v)).filter(v => v !== 0);

        if (absValues.length === 0) {
            return null;
        }

        let gcd = absValues[0];
        for (let i = 1; i < absValues.length; i++) {
            gcd = this.computeGcd(gcd, absValues[i]);
        }

        const reduced = values.map(v => v / gcd);
        const firstNonZero = reduced.find(v => v !== 0);

        if (firstNonZero < 0) {
            return reduced.map(v => -v);
        }

        return reduced;
    }

    findNiceIntegerDirection(direction) {
        const dir = direction.clone();
        if (dir.lengthSq() < 1e-10) {
            return null;
        }

        dir.normalize();
        const components = [dir.x, dir.y, dir.z];

        let best = null;

        for (let scale = 1; scale <= 140; scale++) {
            const scaled = components.map(component => component * scale);
            const rounded = scaled.map(value => Math.round(value));

            if (rounded.every(value => value === 0)) {
                continue;
            }

            const maxError = Math.max(
                Math.abs(scaled[0] - rounded[0]),
                Math.abs(scaled[1] - rounded[1]),
                Math.abs(scaled[2] - rounded[2])
            );

            if (maxError > 0.08) {
                continue;
            }

            const reduced = this.reduceIntegerTriple(rounded[0], rounded[1], rounded[2]);
            if (!reduced) {
                continue;
            }

            const maxAbs = Math.max(Math.abs(reduced[0]), Math.abs(reduced[1]), Math.abs(reduced[2]));
            const sumAbs = Math.abs(reduced[0]) + Math.abs(reduced[1]) + Math.abs(reduced[2]);
            const score = maxError + (maxAbs * 0.003) + (sumAbs * 0.0008);

            if (!best || score < best.score) {
                best = { direction: reduced, score };
            }
        }

        return best ? new THREE.Vector3(best.direction[0], best.direction[1], best.direction[2]) : null;
    }

    findNicePointForDirection(point, integerDirection) {
        const direction = [integerDirection.x, integerDirection.y, integerDirection.z];
        const pointArray = [point.x, point.y, point.z];

        let best = null;

        for (let denominator = 1; denominator <= 24; denominator++) {
            for (let numerator = -320; numerator <= 320; numerator++) {
                const s = numerator / denominator;

                const candidate = [
                    pointArray[0] + s * direction[0],
                    pointArray[1] + s * direction[1],
                    pointArray[2] + s * direction[2]
                ];

                const rounded = candidate.map(value => Math.round(value));
                const errors = candidate.map((value, index) => Math.abs(value - rounded[index]));
                const maxError = Math.max(errors[0], errors[1], errors[2]);

                if (maxError > 0.08) {
                    continue;
                }

                const maxAbs = Math.max(Math.abs(rounded[0]), Math.abs(rounded[1]), Math.abs(rounded[2]));
                if (maxAbs > 300) {
                    continue;
                }

                const score = (errors[0] + errors[1] + errors[2]) + (maxAbs * 0.0015);

                if (!best || score < best.score) {
                    best = {
                        point: new THREE.Vector3(rounded[0], rounded[1], rounded[2]),
                        score
                    };
                }
            }
        }

        return best ? best.point : null;
    }

    getNiceLineEquation(point, direction) {
        const integerDirection = this.findNiceIntegerDirection(direction);

        if (!integerDirection) {
            return {
                point: point.clone(),
                direction: direction.clone()
            };
        }

        const nicerPoint = this.findNicePointForDirection(point, integerDirection);

        return {
            point: nicerPoint || point.clone(),
            direction: integerDirection
        };
    }

    createLineEquationLabel(point, direction) {
        const niceEquation = this.getNiceLineEquation(point, direction);

        // Format line equation: r = (px, py, pz) + t(dx, dy, dz)
        const px = Math.abs(niceEquation.point.x) < 0.01 ? 0 : parseFloat(niceEquation.point.x.toFixed(2));
        const py = Math.abs(niceEquation.point.y) < 0.01 ? 0 : parseFloat(niceEquation.point.y.toFixed(2));
        const pz = Math.abs(niceEquation.point.z) < 0.01 ? 0 : parseFloat(niceEquation.point.z.toFixed(2));
        const dx = Math.abs(niceEquation.direction.x) < 0.01 ? 0 : parseFloat(niceEquation.direction.x.toFixed(2));
        const dy = Math.abs(niceEquation.direction.y) < 0.01 ? 0 : parseFloat(niceEquation.direction.y.toFixed(2));
        const dz = Math.abs(niceEquation.direction.z) < 0.01 ? 0 : parseFloat(niceEquation.direction.z.toFixed(2));
        
        const text = `r = (${px}, ${py}, ${pz}) + t(${dx}, ${dy}, ${dz})`;
        
        // Create canvas for the text
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        
        // Clear background
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        context.fillStyle = '#FFFFFF';
        context.font = 'bold 50px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, 512, 64);
        
        // Create texture and plane mesh instead of sprite
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.FrontSide
        });
        
        // Scale based on camera distance
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = distanceToTarget * 0.08;
        
        // Create plane geometry oriented along the line
        const geometry = new THREE.PlaneGeometry(scale * 8, scale);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 1001; // Render on top
        
        return mesh;
    }

    getIntersectionRainbowColor() {
        const hue = (((performance.now() / 1000) * this.angleRainbowSpeed) + this.intersectionRainbowPhase) % 1;
        return new THREE.Color().setHSL(hue, 1.0, 0.5);
    }

    orientPlaneIntersectionLabel(intersectionEntry) {
        if (!intersectionEntry?.label || !intersectionEntry?.direction || !intersectionEntry?.midpoint) return;

        const lineDir = intersectionEntry.direction.clone().normalize();
        const midpoint = intersectionEntry.midpoint;
        const toCamera = new THREE.Vector3().subVectors(this.camera.position, midpoint).normalize();

        // Label normal always faces camera (prevents back-to-front mirroring)
        let forward = toCamera.clone();

        // Align text direction to line direction projected into the camera plane
        let right = lineDir.clone().sub(forward.clone().multiplyScalar(lineDir.dot(forward)));
        if (right.lengthSq() < 1e-8) {
            right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        }
        right.normalize();

        // Stabilize left-to-right text direction against camera right
        const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
        if (right.dot(cameraRight) < 0) {
            right.negate();
        }

        let up = new THREE.Vector3().crossVectors(forward, right).normalize();

        // Stabilize vertical orientation against camera up (prevents upside-down text)
        const cameraUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
        if (up.dot(cameraUp) < 0) {
            up.negate();
            right.negate();
        }

        right = new THREE.Vector3().crossVectors(up, forward).normalize();

        if (right.lengthSq() < 1e-8 || up.lengthSq() < 1e-8 || forward.lengthSq() < 1e-8) {
            return;
        }

        if (new THREE.Vector3().crossVectors(right, up).dot(forward) < 0) {
            forward.negate();
        }

        const labelOffset = this.camera.position.distanceTo(this.controls.target) * 0.15;
        intersectionEntry.label.position.copy(midpoint)
            .add(up.clone().multiplyScalar(labelOffset * 0.6))
            .add(forward.clone().multiplyScalar(labelOffset * 0.4));

        const rotMatrix = new THREE.Matrix4();
        rotMatrix.makeBasis(right, up, forward);
        intersectionEntry.label.quaternion.setFromRotationMatrix(rotMatrix);
    }

    updateIntersectionVisualizationColorCycle() {
        const rainbow = this.getIntersectionRainbowColor();

        this.intersectionMarkers.forEach(({ marker, label }) => {
            if (marker?.material?.color) {
                marker.material.color.copy(rainbow);
            }
            if (label?.material?.color) {
                label.material.color.copy(rainbow);
            }
        });

        this.planeIntersectionLines.forEach((entry) => {
            const { line, label } = entry;
            if (line?.material?.color) {
                line.material.color.copy(rainbow);
            }
            if (label?.material?.color) {
                label.material.color.copy(rainbow);
            }

            this.orientPlaneIntersectionLabel(entry);
        });
    }

    updateIntersections() {
        // Clear existing markers
        this.clearIntersections();

        if (!this.intersectionsVisible) {
            this.updateVectorPanel();
            this.updateLinePanel();
            this.updatePlanePanel();
            this.updateAngleVisualization();
            return;
        }
        
        // Check all line-plane pairs (3D only)
        if (this.dimension === '3d') {
            this.lines.forEach(line => {
                if (!line.visible) return;
                
                this.planes.forEach(plane => {
                    if (!plane.visible) return;
                    
                    const intersection = this.calculateLinePlaneIntersection(line, plane);
                    if (!intersection) return;
                    
                    // Create marker sphere
                    const thickness = this.getArrowThickness();
                    const markerRadius = thickness.headWidth * 0.4;
                    const sphereGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
                    const sphereMaterial = new THREE.MeshBasicMaterial({
                        color: 0xFFFF00, // Yellow marker
                        depthWrite: true,
                        depthTest: true
                    });
                    const marker = new THREE.Mesh(sphereGeometry, sphereMaterial);
                    marker.position.copy(intersection);
                    marker.renderOrder = 2;
                    
                    // Create label
                    const label = this.createIntersectionLabel(intersection);
                    const labelOffset = this.camera.position.distanceTo(this.controls.target) * 0.15;
                    label.position.copy(intersection);
                    label.position.x += labelOffset;
                    
                    // Store marker and label
                    this.intersectionMarkers.push({ marker, label });
                    this.scene.add(marker);
                    this.scene.add(label);
                });
            });
        }
        
        // Check all plane-plane pairs (3D only)
        if (this.dimension === '3d') {
            for (let i = 0; i < this.planes.length; i++) {
                const plane1 = this.planes[i];
                if (!plane1.visible) continue;
                
                for (let j = i + 1; j < this.planes.length; j++) {
                const plane2 = this.planes[j];
                if (!plane2.visible) continue;
                
                const intersectionLine = this.calculatePlanePlaneIntersection(plane1, plane2);
                if (!intersectionLine) continue;
                
                // Render the intersection line
                const { point, direction } = intersectionLine;
                const tMin = -100;
                const tMax = 100;
                
                const start = new THREE.Vector3(
                    point.x + tMin * direction.x,
                    point.y + tMin * direction.y,
                    point.z + tMin * direction.z
                );
                
                const end = new THREE.Vector3(
                    point.x + tMax * direction.x,
                    point.y + tMax * direction.y,
                    point.z + tMax * direction.z
                );
                
                // Use cylinder for the line
                const thickness = this.getArrowThickness();
                const lineRadius = thickness.headWidth * 0.3; // Thicker than regular lines
                const radialSegments = 16;
                
                const dir = new THREE.Vector3().subVectors(end, start);
                const length = dir.length();
                dir.normalize();
                
                const geometry = new THREE.CylinderGeometry(
                    lineRadius,
                    lineRadius,
                    length,
                    radialSegments,
                    1,
                    false
                );
                
                const material = new THREE.MeshBasicMaterial({
                    color: 0x00FFFF, // Cyan for plane intersections
                    depthWrite: true,
                    depthTest: true,
                    transparent: true,
                    opacity: 0.8
                });
                
                const lineMesh = new THREE.Mesh(geometry, material);
                
                // Position at midpoint
                const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                lineMesh.position.copy(midpoint);
                
                // Orient along direction
                const axis = new THREE.Vector3(0, 1, 0);
                const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, dir);
                lineMesh.quaternion.copy(quaternion);
                
                lineMesh.renderOrder = 2;
                
                // Create equation label oriented along the line
                const label = this.createLineEquationLabel(point, direction);

                const intersectionEntry = {
                    line: lineMesh,
                    label,
                    direction: dir.clone().normalize(),
                    midpoint: midpoint.clone()
                };

                // Store line and label
                this.planeIntersectionLines.push(intersectionEntry);
                this.orientPlaneIntersectionLabel(intersectionEntry);
                this.scene.add(lineMesh);
                this.scene.add(label);
            }
        }
        }
        
        // Check all line-line pairs (works in both 2D and 3D)
        for (let i = 0; i < this.lines.length; i++) {
            const line1 = this.lines[i];
            if (!line1.visible) continue;
            
            for (let j = i + 1; j < this.lines.length; j++) {
                const line2 = this.lines[j];
                if (!line2.visible) continue;
                
                const intersection = this.calculateLineLineIntersection(line1, line2);
                if (!intersection) continue;
                
                // Create marker sphere
                const thickness = this.getArrowThickness();
                const markerRadius = thickness.headWidth * 0.5; // Slightly larger for visibility
                const sphereGeometry = new THREE.SphereGeometry(markerRadius, 16, 16);
                const sphereMaterial = new THREE.MeshBasicMaterial({
                    color: 0xFF00FF, // Magenta for line-line intersections
                    depthWrite: true,
                    depthTest: true
                });
                const marker = new THREE.Mesh(sphereGeometry, sphereMaterial);
                marker.position.copy(intersection);
                marker.renderOrder = 2;
                
                // Create label
                const label = this.createIntersectionLabel(intersection);
                const labelOffset = this.camera.position.distanceTo(this.controls.target) * 0.15;
                label.position.copy(intersection);
                label.position.x += labelOffset;
                
                // Store marker and label
                this.intersectionMarkers.push({ marker, label });
                this.scene.add(marker);
                this.scene.add(label);
            }
        }
        
        // Update info panels if they're open
        this.updateVectorPanel();
        this.updateLinePanel();
        this.updatePlanePanel();
        this.updateAngleVisualization();
    }

    clearIntersections() {
        // Remove all intersection markers from scene
        this.intersectionMarkers.forEach(({ marker, label }) => {
            this.scene.remove(marker);
            this.scene.remove(label);
        });
        this.intersectionMarkers = [];
        
        // Remove all plane intersection lines
        this.planeIntersectionLines.forEach(({ line, label }) => {
            this.scene.remove(line);
            this.scene.remove(label);
        });
        this.planeIntersectionLines = [];
    }

    updateNumberLabelScales() {
        // Update all number label scales and positions to maintain consistent screen size and distance
        if (!this.axisNumbers || !this.gridVisible || !this.axisNumbers.visible || this.axisNumbers.children.length === 0) return;
        
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = this.getAxisNumberLabelScale(distanceToTarget);
        const labelOffset = distanceToTarget * 0.03;
        
        this.axisNumbers.children.forEach(sprite => {
            sprite.scale.set(scale * 2, scale, 1);
            
            // Update position to maintain consistent offset from axis
            const axis = sprite.userData.axis;
            const value = sprite.userData.value;
            
            if (this.dimension === '2d') {
                if (axis === 'x') {
                    sprite.position.set(value, -labelOffset, 0);
                } else if (axis === 'y') {
                    sprite.position.set(-labelOffset, value, 0);
                }
            } else {
                if (axis === 'x') {
                    sprite.position.set(value, 0, -labelOffset);
                } else if (axis === 'y') {
                    sprite.position.set(-labelOffset, value, 0);
                } else if (axis === 'z') {
                    sprite.position.set(0, -labelOffset, value);
                }
            }
        });
    }

    updatePointSphereScales() {
        // Calculate scale based on camera distance to target
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const sizeFactor = this.getVectorSizeModeFactor();
        
        if (this.dimension === '2d') {
            // In 2D, scale with distance to maintain constant screen size
            const screenConstantScale = distanceToTarget * 0.085 * sizeFactor;
            
            this.vectors.forEach(vec => {
                if (vec.pointSphere) {
                    if (vec.pointSphere.isSprite) {
                        const spriteScale = screenConstantScale * 0.34;
                        vec.pointSphere.scale.set(spriteScale, spriteScale, 1);
                    } else {
                        vec.pointSphere.scale.set(screenConstantScale, screenConstantScale, screenConstantScale);
                    }
                }
            });
            return;
        }
        
        // 3D mode: Update sphere scales based on camera distance
        const baseScale = distanceToTarget * 0.08 * sizeFactor;
        
        // Set minimum scale to ensure visibility at all zoom levels
        const minScale = 0.2 * sizeFactor;
        const maxScaleLimit = 8.0;
        
        this.vectors.forEach(vec => {
            if (vec.pointSphere) {
                // Cap sphere radius to be proportional to vector length (10% max)
                const vectorLength = vec.currentEnd.length();
                const maxScale = (vectorLength * 0.1) / 0.15; // 0.15 is the base sphere radius
                
                // Apply both minimum and maximum constraints
                const clampedScale = Math.max(minScale, Math.min(Math.min(baseScale, maxScale), maxScaleLimit));
                
                vec.pointSphere.scale.set(clampedScale, clampedScale, clampedScale);
            }
        });
    }

    updateTheme() {
        // Update scene background color based on current theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.scene.background = new THREE.Color(currentTheme === 'light' ? 0xFDFDFD : 0x606060);
        
        // Regenerate grid and axis numbers with theme-appropriate colors
        this.createGrid();

        // Refresh preset edge color (black in light mode, white in dark mode)
        this.updateVectorDisplay();
        this.scheduleStateSave();
    }

    // Eigenvalue and Eigenvector Computation
    computeEigenvalues2D(matrix) {
        // Extract matrix elements - THREE.Matrix3 stores in column-major order
        // elements = [n11, n21, n31, n12, n22, n32, n13, n23, n33]
        // For 2D: [[a, b],  stored as [a, c, _, b, d, _, ...] 
        //          [c, d]]
        const a = matrix.elements[0]; // n11 = a
        const c = matrix.elements[1]; // n21 = c  
        const b = matrix.elements[3]; // n12 = b
        const d = matrix.elements[4]; // n22 = d
        
        // Characteristic polynomial: λ² - trace(A)λ + det(A) = 0
        const trace = a + d;
        const det = a * d - b * c;
        
        // Quadratic formula: λ = (trace ± √(trace² - 4det)) / 2
        const discriminant = trace * trace - 4 * det;
        
        if (discriminant < -1e-10) {
            // Complex eigenvalues - return complex eigenvalue info
            const realPart = trace / 2;
            const imagPart = Math.sqrt(-discriminant) / 2;
            return [
                { value: realPart, imaginary: imagPart, isComplex: true },
                { value: realPart, imaginary: -imagPart, isComplex: true }
            ];
        }
        
        const sqrtDisc = Math.sqrt(Math.max(0, discriminant));
        const lambda1 = (trace + sqrtDisc) / 2;
        const lambda2 = (trace - sqrtDisc) / 2;
        
        const eigenvalues = [];
        const epsilon = 1e-10;
        
        // Check if matrix is identity or scalar multiple of identity
        const isIdentityLike = Math.abs(b) < epsilon && Math.abs(c) < epsilon && 
                               Math.abs(a - d) < epsilon;
        
        if (isIdentityLike) {
            // For identity-like matrices, all directions are eigenvectors
            // Show two perpendicular representative eigenvectors
            if (Math.abs(lambda1) > epsilon) {
                eigenvalues.push({ value: lambda1, vector: new THREE.Vector2(1, 0) });
                eigenvalues.push({ value: lambda1, vector: new THREE.Vector2(0, 1) });
            }
            return eigenvalues;
        }
        
        // Eigenvalue 1
        const v1 = this.computeEigenvector2D(a, b, c, d, lambda1);
        if (v1) {
            eigenvalues.push({ value: lambda1, vector: v1 });
        }
        
        // Eigenvalue 2 (only if different from lambda1)
        if (Math.abs(lambda1 - lambda2) > epsilon) {
            const v2 = this.computeEigenvector2D(a, b, c, d, lambda2);
            if (v2) {
                eigenvalues.push({ value: lambda2, vector: v2 });
            }
        }
        
        return eigenvalues;
    }

    computeEigenvector2D(a, b, c, d, lambda) {
        const epsilon = 1e-10;
        
        // Solve (A - λI)v = 0
        // [a-λ   b  ] [v1] = [0]
        // [c   d-λ ] [v2]   [0]
        
        const a_l = a - lambda;
        const d_l = d - lambda;
        
        // Use the row with larger magnitude for stability
        if (Math.abs(b) > epsilon) {
            // From first row: (a-λ)v1 + b*v2 = 0, so v2 = -(a-λ)v1/b
            // Normalize: choose v1 = b, v2 = -(a-λ)
            const v1 = b;
            const v2 = -a_l;
            const mag = Math.sqrt(v1 * v1 + v2 * v2);
            if (mag > epsilon) {
                return new THREE.Vector2(v1 / mag, v2 / mag);
            }
        }
        
        if (Math.abs(c) > epsilon) {
            // From second row: c*v1 + (d-λ)v2 = 0, so v1 = -(d-λ)v2/c
            // Normalize: choose v2 = c, v1 = -(d-λ)
            const v1 = -d_l;
            const v2 = c;
            const mag = Math.sqrt(v1 * v1 + v2 * v2);
            if (mag > epsilon) {
                return new THREE.Vector2(v1 / mag, v2 / mag);
            }
        }
        
        // If both b and c are near zero, try using diagonal elements
        if (Math.abs(a_l) > epsilon) {
            return new THREE.Vector2(0, 1);
        } else if (Math.abs(d_l) > epsilon) {
            return new THREE.Vector2(1, 0);
        }
        
        // Default to arbitrary direction if matrix is λI
        return new THREE.Vector2(1, 0);
    }

    computeSecondEigenvector2D(a, b, c, d, lambda) {
        // For repeated eigenvalue, check if we have 2D eigenspace
        const a_l = a - lambda;
        const d_l = d - lambda;
        const epsilon = 1e-10;
        
        // If A - λI is zero matrix, entire space is eigenspace
        if (Math.abs(a_l) < epsilon && Math.abs(b) < epsilon && 
            Math.abs(c) < epsilon && Math.abs(d_l) < epsilon) {
            // Return perpendicular to first eigenvector
            const v1 = this.computeEigenvector2D(a, b, c, d, lambda);
            return new THREE.Vector2(-v1.y, v1.x);
        }
        
        return null;
    }

    computeEigenvalues3D(matrix) {
        // For 3D, we'll use a numerical method to find eigenvalues
        const epsilon = 1e-10;
        
        // Extract matrix elements (column-major order in THREE.Matrix3)
        // elements = [n11, n21, n31, n12, n22, n32, n13, n23, n33]
        const m = matrix.elements;
        const a11 = m[0], a21 = m[1], a31 = m[2];
        const a12 = m[3], a22 = m[4], a32 = m[5];
        const a13 = m[6], a23 = m[7], a33 = m[8];
        
        // Characteristic polynomial coefficients: -λ³ + c2λ² + c1λ + c0 = 0
        const c2 = a11 + a22 + a33; // trace
        const c1 = -(a11*a22 + a11*a33 + a22*a33 - a12*a21 - a13*a31 - a23*a32);
        const c0 = a11*a22*a33 + a12*a23*a31 + a13*a21*a32 - 
                   a13*a22*a31 - a12*a21*a33 - a11*a23*a32; // determinant
        
        // Use cubic formula (all real roots for real symmetric matrices)
        const eigenvalues = this.solveCubic(1, -c2, -c1, -c0);
        
        const result = [];
        const processedEigenvalues = new Map(); // Map eigenvalue -> {vectors: [], count: number}
        
        // Group eigenvalues by value and count multiplicities
        for (const lambda of eigenvalues) {
            const realValue = lambda.real;
            
            // Skip if imaginary part is too large
            if (Math.abs(lambda.imag) > epsilon) {
                continue;
            }
            
            // Check if we already have this eigenvalue
            let found = false;
            for (const [key, data] of processedEigenvalues) {
                if (Math.abs(realValue - key) < 1e-6) {
                    data.count++;
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                processedEigenvalues.set(realValue, { vectors: [], count: 1 });
            }
        }
        
        // For each unique eigenvalue, find eigenvectors
        for (const [eigenvalue, data] of processedEigenvalues) {
            const existingVectors = data.vectors;
            
            // Try to find up to 'count' linearly independent eigenvectors
            for (let i = 0; i < data.count; i++) {
                const v = this.computeEigenvector3D(m, eigenvalue, existingVectors);
                
                if (v) {
                    // Check if this is actually a new direction (not too similar to existing)
                    let isDuplicate = false;
                    for (const existing of existingVectors) {
                        if (Math.abs(v.dot(existing)) > 0.99) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    
                    if (!isDuplicate) {
                        existingVectors.push(v);
                        result.push({ value: eigenvalue, vector: v });
                    } else {
                        // Repeated eigenvalue but can't find independent eigenvector
                        // Still report the eigenvalue with the same eigenvector
                        result.push({ value: eigenvalue, vector: existingVectors[0] || v });
                    }
                } else {
                    // Couldn't find a vector - still need to report the eigenvalue!
                    if (existingVectors.length > 0) {
                        // Reuse existing eigenvector
                        result.push({ value: eigenvalue, vector: existingVectors[0] });
                    }
                    // If no vector found at all, skip this eigenvalue occurrence
                }
            }
        }
        
        return result;
    }

    solveCubic(a, b, c, d) {
        // Solve at³ + bt² + ct + d = 0
        // Returns array of {real, imag} solutions
        
        // Normalize
        b /= a; c /= a; d /= a;
        
        // Depress the cubic: t = x - b/3
        const p = c - b * b / 3;
        const q = 2 * b * b * b / 27 - b * c / 3 + d;
        
        const discriminant = -(4 * p * p * p + 27 * q * q);
        
        const solutions = [];
        const epsilon = 1e-10;
        
        if (discriminant > -epsilon) {
            // Three real roots
            if (Math.abs(p) < epsilon) {
                // Special case: p ≈ 0
                const root = Math.cbrt(-q) - b / 3;
                solutions.push({ real: root, imag: 0 });
                solutions.push({ real: root, imag: 0 });
                solutions.push({ real: root, imag: 0 });
            } else {
                const sqrt3 = Math.sqrt(3);
                const sqrtNegP3 = Math.sqrt(-p / 3);
                // Clamp the argument to acos to avoid NaN from floating-point errors
                const acosArg = Math.max(-1, Math.min(1, -q / (2 * sqrtNegP3 * sqrtNegP3 * sqrtNegP3)));
                const theta = Math.acos(acosArg) / 3;
                
                for (let k = 0; k < 3; k++) {
                    const root = 2 * sqrtNegP3 * Math.cos(theta - 2 * Math.PI * k / 3) - b / 3;
                    solutions.push({ real: root, imag: 0 });
                }
            }
        } else {
            // One real root, two complex conjugates
            const sqrtTerm = Math.sqrt(-discriminant / 108);
            const A = Math.cbrt(-q / 2 + sqrtTerm);
            const B = Math.cbrt(-q / 2 - sqrtTerm);
            const root = A + B - b / 3;
            solutions.push({ real: root, imag: 0 });
            
            // Two complex conjugate roots
            const realPart = -(A + B) / 2 - b / 3;
            const imagPart = Math.abs(A - B) * Math.sqrt(3) / 2;
            solutions.push({ real: realPart, imag: imagPart });
            solutions.push({ real: realPart, imag: -imagPart });
        }
        
        return solutions;
    }

    computeEigenvector3D(m, lambda, avoidDirections = []) {
        const epsilon = 1e-8;
        
        // Create (A - λI)
        // m is already in column-major: [n11, n21, n31, n12, n22, n32, n13, n23, n33]
        const a11 = m[0] - lambda, a21 = m[1], a31 = m[2];
        const a12 = m[3], a22 = m[4] - lambda, a32 = m[5];
        const a13 = m[6], a23 = m[7], a33 = m[8] - lambda;
        
        // Find eigenvector by nullspace of (A - λI)
        // Try cross product of two rows to get perpendicular vector
        
        const row1 = new THREE.Vector3(a11, a12, a13);
        const row2 = new THREE.Vector3(a21, a22, a23);
        const row3 = new THREE.Vector3(a31, a32, a33);
        
        const mag1 = row1.lengthSq();
        const mag2 = row2.lengthSq();
        const mag3 = row3.lengthSq();
        
        // Special case: all rows are zero (identity matrix case - 3D eigenspace)
        const isIdentityCase = mag1 < epsilon && mag2 < epsilon && mag3 < epsilon;
        
        if (isIdentityCase) {
            // All of space is the eigenspace - return standard basis vectors
            // Choose vectors orthogonal to already-found eigenvectors
            if (avoidDirections.length === 0) {
                return new THREE.Vector3(1, 0, 0);
            } else if (avoidDirections.length === 1) {
                // Find vector orthogonal to first
                const v = avoidDirections[0];
                if (Math.abs(v.x) < 0.9) {
                    return new THREE.Vector3(1, 0, 0).cross(v).normalize();
                } else {
                    return new THREE.Vector3(0, 1, 0).cross(v).normalize();
                }
            } else {
                // Find vector orthogonal to first two
                return new THREE.Vector3().crossVectors(avoidDirections[0], avoidDirections[1]).normalize();
            }
        }
        
        // Check if we have a degenerate case (2D or higher eigenspace)
        // This happens when rows are proportional or some rows are zero
        let isDegenerate = false;
        let normalRow = null;
        
        // Check if at least two non-zero rows are proportional
        if (mag1 > epsilon && mag2 > epsilon && 
            Math.abs(row1.clone().normalize().dot(row2.clone().normalize())) > 0.99) {
            isDegenerate = true;
            normalRow = row1;
        } else if (mag1 > epsilon && mag3 > epsilon && 
            Math.abs(row1.clone().normalize().dot(row3.clone().normalize())) > 0.99) {
            isDegenerate = true;
            normalRow = row1;
        } else if (mag2 > epsilon && mag3 > epsilon && 
            Math.abs(row2.clone().normalize().dot(row3.clone().normalize())) > 0.99) {
            isDegenerate = true;
            normalRow = row2;
        } else if (mag1 < epsilon && mag2 > epsilon) {
            // Row 1 is zero, use row 2
            isDegenerate = true;
            normalRow = row2;
        } else if (mag1 < epsilon && mag3 > epsilon) {
            // Row 1 is zero, use row 3
            isDegenerate = true;
            normalRow = row3;
        } else if (mag2 < epsilon && mag1 > epsilon) {
            // Row 2 is zero, use row 1
            isDegenerate = true;
            normalRow = row1;
        } else if (mag2 < epsilon && mag3 > epsilon) {
            // Row 2 is zero, use row 3
            isDegenerate = true;
            normalRow = row3;
        } else if (mag3 < epsilon && mag1 > epsilon) {
            // Row 3 is zero, use row 1
            isDegenerate = true;
            normalRow = row1;
        } else if (mag3 < epsilon && mag2 > epsilon) {
            // Row 3 is zero, use row 2
            isDegenerate = true;
            normalRow = row2;
        }
        
        if (isDegenerate && normalRow) {
            // All rows are the same or proportional or some are zero - 2D or 3D eigenspace
            // Find any vector perpendicular to the non-zero row
            normalRow = normalRow.clone().normalize();
            
            // Try to find a vector perpendicular to both normal and all avoidDirections
            let v1;
            
            if (avoidDirections.length === 0) {
                // First eigenvector - just perpendicular to normal
                if (Math.abs(normalRow.x) < 0.9) {
                    v1 = new THREE.Vector3(1, 0, 0).cross(normalRow).normalize();
                } else {
                    v1 = new THREE.Vector3(0, 1, 0).cross(normalRow).normalize();
                }
            } else if (avoidDirections.length === 1) {
                // Second eigenvector - perpendicular to both normal and first eigenvector
                v1 = new THREE.Vector3().crossVectors(normalRow, avoidDirections[0]);
                if (v1.lengthSq() < epsilon) {
                    // They're parallel, use different approach
                    if (Math.abs(normalRow.x) < 0.9) {
                        v1 = new THREE.Vector3(1, 0, 0).cross(normalRow).normalize();
                    } else {
                        v1 = new THREE.Vector3(0, 1, 0).cross(normalRow).normalize();
                    }
                } else {
                    v1.normalize();
                }
            } else {
                // Third eigenvector - perpendicular to first two eigenvectors
                v1 = new THREE.Vector3().crossVectors(avoidDirections[0], avoidDirections[1]);
                if (v1.lengthSq() < epsilon) {
                    // Try standard basis vectors
                    for (const testVec of [
                        new THREE.Vector3(1, 0, 0),
                        new THREE.Vector3(0, 1, 0),
                        new THREE.Vector3(0, 0, 1)
                    ]) {
                        let isIndependent = true;
                        for (const avoid of avoidDirections) {
                            if (Math.abs(testVec.dot(avoid)) > 0.99) {
                                isIndependent = false;
                                break;
                            }
                        }
                        if (isIndependent) {
                            v1 = testVec;
                            break;
                        }
                    }
                } else {
                    v1.normalize();
                }
            }
            
            // Verify v1 is in the nullspace
            const test1 = new THREE.Vector3(
                a11 * v1.x + a12 * v1.y + a13 * v1.z,
                a21 * v1.x + a22 * v1.y + a23 * v1.z,
                a31 * v1.x + a32 * v1.y + a33 * v1.z
            );
            
            if (test1.length() < 0.01) {
                return v1;
            }
        }
        
        // Try all pairs of rows for cross product
        const candidates = [];
        
        if (mag1 > epsilon && mag2 > epsilon) {
            const v = new THREE.Vector3().crossVectors(row1, row2);
            if (v.lengthSq() > epsilon) {
                candidates.push(v.normalize());
            }
        }
        
        if (mag1 > epsilon && mag3 > epsilon) {
            const v = new THREE.Vector3().crossVectors(row1, row3);
            if (v.lengthSq() > epsilon) {
                candidates.push(v.normalize());
            }
        }
        
        if (mag2 > epsilon && mag3 > epsilon) {
            const v = new THREE.Vector3().crossVectors(row2, row3);
            if (v.lengthSq() > epsilon) {
                candidates.push(v.normalize());
            }
        }
        
        // Verify each candidate by checking if (A - λI)v ≈ 0
        for (const v of candidates) {
            const result = new THREE.Vector3(
                a11 * v.x + a12 * v.y + a13 * v.z,
                a21 * v.x + a22 * v.y + a23 * v.z,
                a31 * v.x + a32 * v.y + a33 * v.z
            );
            const error = result.length();
            
            if (error < 0.01) {
                // Make sure it's not too similar to avoided directions
                let isTooSimilar = false;
                for (const avoid of avoidDirections) {
                    if (Math.abs(v.dot(avoid)) > 0.99) {
                        isTooSimilar = true;
                        break;
                    }
                }
                if (!isTooSimilar) {
                    return v;
                }
            }
        }
        
        // If cross products didn't work, try to solve the system directly
        // Find which components are constrained and which are free
        
        // Collect non-zero rows
        const nonZeroRows = [];
        if (mag1 > epsilon) nonZeroRows.push(row1);
        if (mag2 > epsilon) nonZeroRows.push(row2);
        if (mag3 > epsilon) nonZeroRows.push(row3);
        
        if (nonZeroRows.length === 0) {
            // All rows zero - shouldn't happen as we checked this above
            return new THREE.Vector3(1, 0, 0);
        } else if (nonZeroRows.length === 1) {
            // One constraint - 2D nullspace
            // Find vector perpendicular to the row, avoiding already-found directions
            const constraintRow = nonZeroRows[0].clone().normalize();
            
            for (const avoid of avoidDirections) {
                // Remove component parallel to avoid direction
                const v = new THREE.Vector3().crossVectors(constraintRow, avoid);
                if (v.lengthSq() > epsilon) {
                    v.normalize();
                    // Verify
                    const test = new THREE.Vector3(
                        a11 * v.x + a12 * v.y + a13 * v.z,
                        a21 * v.x + a22 * v.y + a23 * v.z,
                        a31 * v.x + a32 * v.y + a33 * v.z
                    );
                    if (test.length() < 0.01) {
                        return v;
                    }
                }
            }
            
            // No avoid directions, just find any perpendicular
            if (Math.abs(constraintRow.x) < 0.9) {
                return new THREE.Vector3(1, 0, 0).cross(constraintRow).normalize();
            } else {
                return new THREE.Vector3(0, 1, 0).cross(constraintRow).normalize();
            }
        }
        
        // Fallback: try standard basis vectors
        // If one component is very small in all rows, set it to 1 and solve for others
        
        // Try setting z = 1 and solving for x, y
        if (Math.abs(a13) < epsilon && Math.abs(a23) < epsilon) {
            // System: a11*x + a12*y = -a13*1, a21*x + a22*y = -a23*1
            // Since a13, a23 ≈ 0: a11*x + a12*y ≈ 0, a21*x + a22*y ≈ 0
            const det = a11 * a22 - a12 * a21;
            if (Math.abs(det) > epsilon) {
                return new THREE.Vector3(a22, -a21, 0).normalize();
            }
        }
        
        // Try setting y = 1 and solving for x, z
        if (Math.abs(a12) < epsilon && Math.abs(a32) < epsilon) {
            const det = a11 * a33 - a13 * a31;
            if (Math.abs(det) > epsilon) {
                return new THREE.Vector3(a33, 0, -a31).normalize();
            }
        }
        
        // Try setting x = 1 and solving for y, z
        if (Math.abs(a21) < epsilon && Math.abs(a31) < epsilon) {
            const det = a22 * a33 - a23 * a32;
            if (Math.abs(det) > epsilon) {
                return new THREE.Vector3(0, a33, -a32).normalize();
            }
        }
        
        return null;
    }

    // Visualization of Invariant Spaces
    createDashedTexture() {
        // Create a canvas for the dashed pattern
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Two bright neon colors
        const color1 = '#00ffff'; // Cyan
        const color2 = '#ff00ff'; // Magenta
        
        // Create horizontal stripes (will wrap around cylinder)
        const stripeWidth = 16;
        for (let i = 0; i < canvas.height; i += stripeWidth * 2) {
            ctx.fillStyle = color1;
            ctx.fillRect(0, i, canvas.width, stripeWidth);
            ctx.fillStyle = color2;
            ctx.fillRect(0, i + stripeWidth, canvas.width, stripeWidth);
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 8);
        return texture;
    }
    
    createCheckerboardTexture() {
        // Create a canvas for the checkerboard pattern
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Two subtle pastel colors - much less intense
        const color1 = '#80e0e0'; // Light cyan with low saturation
        const color2 = '#e080e0'; // Light magenta with low saturation
        
        // Create checkerboard
        const squareSize = 32;
        for (let y = 0; y < canvas.height; y += squareSize) {
            for (let x = 0; x < canvas.width; x += squareSize) {
                const isEven = ((x / squareSize) + (y / squareSize)) % 2 === 0;
                ctx.fillStyle = isEven ? color1 : color2;
                ctx.fillRect(x, y, squareSize, squareSize);
            }
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 4);
        return texture;
    }
    
    clearInvariantSpaces() {
        // Remove all invariant lines
        this.invariantLines.forEach(lineObj => {
            this.scene.remove(lineObj.mesh);
        });
        this.invariantLines = [];
        
        // Remove all invariant planes
        this.invariantPlanes.forEach(planeObj => {
            this.scene.remove(planeObj.mesh);
        });
        this.invariantPlanes = [];
    }

    visualizeInvariantSpaces(matrixId = null) {
        // Clear existing invariant spaces
        this.clearInvariantSpaces();
        
        // Only show invariant spaces when not off
        if (this.invariantDisplayMode === 'off') {
            // Also update eigenvalue panel (it handles hiding itself if needed)
            this.updateEigenvaluePanel(matrixId);
            return;
        }
        
        const matrix = this.getTransformationMatrix(matrixId);
        
        // Check if matrix is a scalar multiple of identity (entire space is invariant)
        if (this.isIdentityLike(matrix)) {
            // For identity-like matrices, show the standard basis vectors as eigenvectors
            // This indicates that the entire space is an eigenspace
            this.visualizeIdentityLikeEigenspace(matrix);
            this.updateEigenvaluePanel(matrixId);
            return;
        }
        
        if (this.dimension === '2d') {
            this.visualizeInvariantSpaces2D(matrix);
        } else {
            this.visualizeInvariantSpaces3D(matrix);
        }
        
        // Update eigenvalue info panel
        this.updateEigenvaluePanel(matrixId);
    }
    
    visualizeIdentityLikeEigenspace(matrix) {
        // For scalar multiples of identity, show standard basis vectors as invariant lines
        const lineRadius = this.getInvariantLineRadius();
        const lineLength = 200;
        
        if (this.dimension === '2d') {
            // Show x and y axes as invariant lines
            const directions = [
                new THREE.Vector3(1, 0, 0), // x-axis
                new THREE.Vector3(0, 1, 0)  // y-axis
            ];
            
            directions.forEach((direction, index) => {
                const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
                
                let material;
                if (this.invariantDisplayMode === 'solid') {
                    const texture = this.createDashedTexture();
                    material = new THREE.MeshBasicMaterial({
                        map: texture,
                        transparent: true,
                        opacity: 0.95,
                        depthTest: false,
                        depthWrite: false
                    });
                } else {
                    material = new THREE.MeshBasicMaterial({
                        color: 0xff00ff,
                        transparent: true,
                        opacity: 0.95,
                        depthTest: false,
                        depthWrite: false
                    });
                }

                material.polygonOffset = true;
                material.polygonOffsetFactor = 12;
                material.polygonOffsetUnits = 12;

                if (this.dimension === '3d') {
                    material.depthTest = false;
                    material.depthWrite = false;
                }
                
                const cylinder = new THREE.Mesh(geometry, material);
                
                const quaternion = new THREE.Quaternion();
                const yAxis = new THREE.Vector3(0, 1, 0);
                quaternion.setFromUnitVectors(yAxis, direction);
                cylinder.quaternion.copy(quaternion);
                cylinder.renderOrder = this.getInvariantLineRenderOrder();
                
                this.scene.add(cylinder);
                this.invariantLines.push({
                    mesh: cylinder,
                    direction: direction.clone(),
                    index: index
                });
            });
        } else {
            // Show x, y, and z axes as invariant lines
            const directions = [
                new THREE.Vector3(1, 0, 0), // x-axis
                new THREE.Vector3(0, 1, 0), // y-axis
                new THREE.Vector3(0, 0, 1)  // z-axis
            ];
            
            directions.forEach((direction, index) => {
                const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
                
                let material;
                if (this.invariantDisplayMode === 'solid') {
                    const texture = this.createDashedTexture();
                    material = new THREE.MeshBasicMaterial({
                        map: texture,
                        transparent: true,
                        opacity: 0.95,
                        depthTest: true,
                        depthWrite: true
                    });
                } else {
                    material = new THREE.MeshBasicMaterial({
                        color: 0xff00ff,
                        transparent: true,
                        opacity: 0.95,
                        depthTest: true,
                        depthWrite: true
                    });
                }

                material.polygonOffset = false;
                material.polygonOffsetFactor = 0;
                material.polygonOffsetUnits = 0;
                
                const cylinder = new THREE.Mesh(geometry, material);
                
                const quaternion = new THREE.Quaternion();
                const yAxis = new THREE.Vector3(0, 1, 0);
                quaternion.setFromUnitVectors(yAxis, direction);
                cylinder.quaternion.copy(quaternion);
                cylinder.renderOrder = this.getInvariantLineRenderOrder();
                
                this.scene.add(cylinder);
                this.invariantLines.push({
                    mesh: cylinder,
                    direction: direction.clone(),
                    index: index
                });
            });
        }
    }
    
    isIdentityLike(matrix) {
        const epsilon = 1e-6;
        const elements = matrix.elements;
        
        if (this.dimension === '2d') {
            // For 2x2: [[a, b], [c, d]] in column-major: [a, c, _, b, d, _, _, _, _]
            const a = elements[0]; // n11 = a
            const c = elements[1]; // n21 = c (off-diagonal)
            const b = elements[3]; // n12 = b (off-diagonal)
            const d = elements[4]; // n22 = d
            
            // Check if diagonal elements are equal and off-diagonal are zero
            return Math.abs(a - d) < epsilon && 
                   Math.abs(b) < epsilon && 
                   Math.abs(c) < epsilon;
        } else {
            // For 3x3: column-major [n11,n21,n31,n12,n22,n32,n13,n23,n33]
            const n11 = elements[0];
            const n21 = elements[1];
            const n31 = elements[2];
            const n12 = elements[3];
            const n22 = elements[4];
            const n32 = elements[5];
            const n13 = elements[6];
            const n23 = elements[7];
            const n33 = elements[8];
            
            // Check if all diagonal elements are equal and all off-diagonal are zero
            return Math.abs(n11 - n22) < epsilon && 
                   Math.abs(n22 - n33) < epsilon &&
                   Math.abs(n21) < epsilon && 
                   Math.abs(n31) < epsilon &&
                   Math.abs(n12) < epsilon && 
                   Math.abs(n32) < epsilon &&
                   Math.abs(n13) < epsilon && 
                   Math.abs(n23) < epsilon;
        }
    }

    visualizeInvariantSpaces2D(matrix) {
        const eigendata = this.computeEigenvalues2D(matrix);

        const lineRadius = this.getInvariantLineRadius();
        
        eigendata.forEach((eigen, index) => {
            // Skip if no vector (e.g., complex eigenvalues)
            if (!eigen.vector) return;
            
            const direction = new THREE.Vector3(eigen.vector.x, eigen.vector.y, 0).normalize();
            
            // Create line using cylinder geometry, thicker than axes
            const lineLength = 200; // Very long line
            
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            
            let material;
            if (this.invariantDisplayMode === 'solid') {
                // Use dashed texture for solid mode with higher opacity
                const texture = this.createDashedTexture();
                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: false,
                    depthWrite: false
                });
            } else {
                // Use bright magenta for pulse mode with higher opacity
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: false,
                    depthWrite: false
                });
            }

            material.polygonOffset = true;
            material.polygonOffsetFactor = 12;
            material.polygonOffsetUnits = 12;

            if (this.dimension === '3d') {
                material.depthTest = false;
                material.depthWrite = false;
            }
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the eigenvector direction
            // CylinderGeometry is aligned along Y axis by default
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines render on top of axes when overlapping
            cylinder.renderOrder = this.getInvariantLineRenderOrder();
            
            this.scene.add(cylinder);
            
            this.invariantLines.push({
                mesh: cylinder,
                eigenvalue: eigen.value,
                direction: direction.clone(),
                index: index
            });
        });
    }

    visualizeInvariantSpaces3D(matrix) {
        const eigendata = this.computeEigenvalues3D(matrix);

        const lineRadius = this.getInvariantLineRadius();
        
        eigendata.forEach((eigen, index) => {
            // Skip if no vector (shouldn't happen in 3D but be safe)
            if (!eigen.vector) return;
            
            const direction = eigen.vector.clone().normalize();
            
            // Create line using cylinder geometry, thicker than axes
            const lineLength = 200; // Very long line
            
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            
            let material;
            if (this.invariantDisplayMode === 'solid') {
                // Use dashed texture for solid mode with higher opacity
                const texture = this.createDashedTexture();
                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: true,
                    depthWrite: true
                });
            } else {
                // Use bright magenta for pulse mode with higher opacity
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: true,
                    depthWrite: true
                });
            }

            material.polygonOffset = false;
            material.polygonOffsetFactor = 0;
            material.polygonOffsetUnits = 0;
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the eigenvector direction
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines render on top of axes when overlapping
            cylinder.renderOrder = this.getInvariantLineRenderOrder();
            
            this.scene.add(cylinder);
            
            this.invariantLines.push({
                mesh: cylinder,
                eigenvalue: eigen.value,
                direction: direction.clone(),
                index: index
            });
        });
        
        // For 3D, visualize invariant planes only if we have a repeated eigenvalue
        // with a 2-dimensional eigenspace
        const epsilon = 1e-6;
        
        // Group eigenvectors by eigenvalue
        const eigenvalueGroups = new Map();
        for (const eigen of eigendata) {
            // Skip if no vector
            if (!eigen.vector) continue;
            
            let found = false;
            for (const [key, group] of eigenvalueGroups) {
                if (Math.abs(eigen.value - key) < epsilon) {
                    // Check if this vector is already in the group (avoid duplicates)
                    let isDuplicate = false;
                    for (const existingVec of group) {
                        if (Math.abs(eigen.vector.dot(existingVec)) > 0.99) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (!isDuplicate) {
                        group.push(eigen.vector);
                    }
                    found = true;
                    break;
                }
            }
            if (!found) {
                eigenvalueGroups.set(eigen.value, [eigen.vector]);
            }
        }
        
        // For each repeated eigenvalue with exactly 2 eigenvectors, create invariant plane
        // (2D eigenspace, not 3D like identity)
        for (const [eigenvalue, vectors] of eigenvalueGroups) {
            if (vectors.length === 2) {
                const v1 = vectors[0];
                const v2 = vectors[1];
                
                // Normal to the plane
                const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
                
                if (normal.lengthSq() > 0.01) {
                    const planeSize = 40;
                    const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
                    
                    let material;
                    if (this.invariantDisplayMode === 'solid') {
                        // Use checkerboard texture for solid mode
                        const texture = this.createCheckerboardTexture();
                        material = new THREE.MeshBasicMaterial({
                            map: texture,
                            side: THREE.DoubleSide,
                            transparent: true,
                            opacity: 0.3,
                            depthWrite: false,
                            depthTest: true
                        });
                    } else {
                        // Use plain color for pulse mode
                        material = new THREE.MeshBasicMaterial({
                            color: 0x00ffff,
                            side: THREE.DoubleSide,
                            transparent: true,
                            opacity: 0.2,
                            depthWrite: false,
                            depthTest: true
                        });
                    }
                    
                    const plane = new THREE.Mesh(geometry, material);
                    
                    // Orient plane perpendicular to normal
                    plane.lookAt(normal);
                    
                    this.scene.add(plane);
                    
                    this.invariantPlanes.push({
                        mesh: plane,
                        normal: normal,
                        eigenvalue: eigenvalue,
                        index: this.invariantPlanes.length
                    });
                }
            }
        }
    }

    updateInvariantSpaceColors() {
        // Skip if invariant display is off or solid (textures already have colors)
        if (this.invariantDisplayMode === 'off' || this.invariantDisplayMode === 'solid') return;
        
        // Update rainbow pulsing effect only for pulse mode
        if (this.invariantDisplayMode === 'pulse') {
            this.rainbowTime += 0.01;
        }
        
        // Update invariant lines
        this.invariantLines.forEach((lineObj, index) => {
            if (this.invariantDisplayMode === 'pulse') {
                // Pulsing rainbow colors - all same color
                const hue = this.rainbowTime % 1.0;
                const saturation = 1.0;
                const lightness = 0.5 + 0.15 * Math.sin(this.rainbowTime * 3);
                
                const color = new THREE.Color().setHSL(hue, saturation, lightness);
                lineObj.mesh.material.color = color;
                
                // Pulse opacity
                const baseOpacity = 0.8;
                const pulseOpacity = 0.2 * Math.sin(this.rainbowTime * 4);
                lineObj.mesh.material.opacity = baseOpacity + pulseOpacity;
            }
        });
        
        // Update invariant planes
        this.invariantPlanes.forEach((planeObj, index) => {
            if (this.invariantDisplayMode === 'pulse') {
                // Pulsing rainbow colors - all same color
                const hue = this.rainbowTime % 1.0;
                const saturation = 0.9;
                const lightness = 0.6 + 0.1 * Math.sin(this.rainbowTime * 3);
                
                const color = new THREE.Color().setHSL(hue, saturation, lightness);
                planeObj.mesh.material.color = color;
                
                // Pulse opacity
                const baseOpacity = 0.15;
                const pulseOpacity = 0.1 * Math.sin(this.rainbowTime * 4);
                planeObj.mesh.material.opacity = baseOpacity + pulseOpacity;
            }
        });
    }

    // Simplify eigenvector to integer form for display
    simplifyEigenvector(vector) {
        const epsilon = 1e-5;
        const components = [vector.x, vector.y, vector.z || 0];
        
        // Find the smallest non-zero component (in absolute value)
        let minAbs = Infinity;
        let minVal = 0;
        for (const val of components) {
            const absVal = Math.abs(val);
            if (absVal > epsilon && absVal < minAbs) {
                minAbs = absVal;
                minVal = val;
            }
        }
        
        // If all components are zero, return as is
        if (minAbs === Infinity) {
            return { x: 0, y: 0, z: 0 };
        }
        
        // Normalize by the smallest component to get ratios
        const ratios = components.map(c => c / minVal);
        
        // Try to find a multiplier that makes all ratios close to integers
        for (let mult = 1; mult <= 50; mult++) {
            const scaled = ratios.map(r => r * mult);
            const rounded = scaled.map(s => Math.round(s));
            
            // Check if all are close to their rounded values
            const allClose = scaled.every((s, i) => Math.abs(s - rounded[i]) < epsilon);
            
            if (allClose) {
                // Found integer representation, now simplify by GCD
                const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);
                let divisor = gcd(gcd(Math.abs(rounded[0]), Math.abs(rounded[1])), Math.abs(rounded[2]));
                if (divisor === 0) divisor = 1;
                
                return {
                    x: rounded[0] / divisor,
                    y: rounded[1] / divisor,
                    z: rounded[2] / divisor
                };
            }
        }
        
        // Fallback: just use the ratios rounded to nearest integer
        const rounded = ratios.map(r => Math.round(r));
        const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);
        let divisor = gcd(gcd(Math.abs(rounded[0]), Math.abs(rounded[1])), Math.abs(rounded[2]));
        if (divisor === 0) divisor = 1;
        
        return {
            x: rounded[0] / divisor,
            y: rounded[1] / divisor,
            z: rounded[2] / divisor
        };
    }

    updateEigenvaluePanel(matrixId = null) {
        const panel = document.getElementById('eigenvalue-panel');
        const valuesDiv = document.getElementById('eigenvalue-values');
        const headerSpan = panel.querySelector('.eigenvalue-header span');
        
        // Use provided matrix ID or fall back to eigenvaluePanelMatrixId
        const targetId = matrixId || this.eigenvaluePanelMatrixId;
        
        // Hide panel if no matrix is specified
        if (!targetId) {
            panel.style.display = 'none';
            return;
        }
        
        // Get the matrix object to extract its name
        const selectedMatrix = this.matrices.find(m => m.id === targetId);
        
        // If matrix doesn't exist (was deleted), hide panel and clear eigenvaluePanelMatrixId
        if (!selectedMatrix) {
            panel.style.display = 'none';
            this.eigenvaluePanelMatrixId = null;
            return;
        }
        
        const matrixName = selectedMatrix.name;
        const matrix = this.getTransformationMatrix(targetId);
        
        // Compute eigenvalues based on dimension
        let eigendata;
        if (this.dimension === '2d') {
            eigendata = this.computeEigenvalues2D(matrix);
        } else {
            eigendata = this.computeEigenvalues3D(matrix);
        }
        
        // If no eigenvalues, hide panel
        if (!eigendata || eigendata.length === 0) {
            panel.style.display = 'none';
            return;
        }
        
        // Update header with matrix name
        if (matrixName) {
            headerSpan.textContent = `${matrixName}: Eigenvalues`;
        } else {
            headerSpan.textContent = 'Eigenvalues';
        }
        
        // Show panel and populate with eigenvalue/eigenvector data
        panel.style.display = 'block';
        valuesDiv.innerHTML = '';
        
        // Format number: smart formatting like matrices
        const formatNum = (val) => {
            if (Math.abs(val) < 0.001) return '0';
            // Check if close to an integer (handles floating-point precision issues)
            const nearestInt = Math.round(val);
            if (Math.abs(val - nearestInt) < 0.0001) {
                return nearestInt.toString();
            }
            return this.formatDisplayNumber(val, 3);
        };
        
        // Display all eigenvalues first
        eigendata.forEach((eigen, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'eigenvalue-item';
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'eigenvalue-label';
            labelDiv.innerHTML = `λ<sub>${index + 1}</sub>:`;
            
            const valueDiv = document.createElement('div');
            valueDiv.className = 'eigenvalue-value';
            
            // Handle complex eigenvalues
            if (eigen.isComplex) {
                const realPart = formatNum(eigen.value);
                const imagPart = formatNum(Math.abs(eigen.imaginary));
                const sign = eigen.imaginary >= 0 ? '+' : '−';
                valueDiv.textContent = `${realPart} ${sign} ${imagPart}i`;
            } else {
                valueDiv.textContent = formatNum(eigen.value);
            }
            
            itemDiv.appendChild(labelDiv);
            itemDiv.appendChild(valueDiv);
            valuesDiv.appendChild(itemDiv);
        });
        
        // Calculate and display determinant
        let determinant;
        if (this.dimension === '2d') {
            // det(A) = ad - bc for [[a,b],[c,d]]
            const a = selectedMatrix.values[0][0];
            const b = selectedMatrix.values[0][1];
            const c = selectedMatrix.values[1][0];
            const d = selectedMatrix.values[1][1];
            determinant = a * d - b * c;
        } else {
            // det(A) = a(ei - fh) - b(di - fg) + c(dh - eg) for 3x3
            const a = selectedMatrix.values[0][0];
            const b = selectedMatrix.values[0][1];
            const c = selectedMatrix.values[0][2];
            const d = selectedMatrix.values[1][0];
            const e = selectedMatrix.values[1][1];
            const f = selectedMatrix.values[1][2];
            const g = selectedMatrix.values[2][0];
            const h = selectedMatrix.values[2][1];
            const i = selectedMatrix.values[2][2];
            determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
        }
        
        // Add separator before determinant
        const detSeparator = document.createElement('div');
        detSeparator.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
        detSeparator.style.margin = '8px 0';
        valuesDiv.appendChild(detSeparator);
        
        // Display determinant
        const detDiv = document.createElement('div');
        detDiv.className = 'eigenvalue-item';
        
        const detLabelDiv = document.createElement('div');
        detLabelDiv.className = 'eigenvalue-label';
        detLabelDiv.textContent = matrixName ? `det ${matrixName}:` : 'det:';
        
        const detValueDiv = document.createElement('div');
        detValueDiv.className = 'eigenvalue-value';
        detValueDiv.textContent = formatNum(determinant);
        
        detDiv.appendChild(detLabelDiv);
        detDiv.appendChild(detValueDiv);
        valuesDiv.appendChild(detDiv);
        
        // Calculate and display trace
        let trace;
        if (this.dimension === '2d') {
            // tr(A) = a + d for [[a,b],[c,d]]
            trace = selectedMatrix.values[0][0] + selectedMatrix.values[1][1];
        } else {
            // tr(A) = a + e + i for 3x3
            trace = selectedMatrix.values[0][0] + selectedMatrix.values[1][1] + selectedMatrix.values[2][2];
        }
        
        // Display trace
        const trDiv = document.createElement('div');
        trDiv.className = 'eigenvalue-item';
        
        const trLabelDiv = document.createElement('div');
        trLabelDiv.className = 'eigenvalue-label';
        trLabelDiv.textContent = matrixName ? `tr ${matrixName}:` : 'tr:';
        
        const trValueDiv = document.createElement('div');
        trValueDiv.className = 'eigenvalue-value';
        trValueDiv.textContent = formatNum(trace);
        
        trDiv.appendChild(trLabelDiv);
        trDiv.appendChild(trValueDiv);
        valuesDiv.appendChild(trDiv);

        const buildCharacteristicEquation = () => {
            const epsilon = 1e-8;

            const formatTerm = (coefficient, power, isFirstTerm = false) => {
                if (Math.abs(coefficient) < epsilon) return '';

                const sign = coefficient < 0 ? '−' : '+';
                const absCoeff = Math.abs(coefficient);
                const needsCoeff = power === 0 || Math.abs(absCoeff - 1) > epsilon;

                let termBody = '';
                if (power === 0) {
                    termBody = formatNum(absCoeff);
                } else if (power === 1) {
                    termBody = needsCoeff ? `${formatNum(absCoeff)}λ` : 'λ';
                } else {
                    termBody = needsCoeff ? `${formatNum(absCoeff)}λ${power === 2 ? '²' : '³'}` : `λ${power === 2 ? '²' : '³'}`;
                }

                if (isFirstTerm) {
                    return coefficient < 0 ? `−${termBody}` : termBody;
                }

                return ` ${sign} ${termBody}`;
            };

            if (this.dimension === '2d') {
                const leading = 'λ²';
                const linear = formatTerm(-trace, 1);
                const constant = formatTerm(determinant, 0);
                return `${leading}${linear}${constant}`;
            }

            const a = selectedMatrix.values[0][0];
            const b = selectedMatrix.values[0][1];
            const c = selectedMatrix.values[0][2];
            const d = selectedMatrix.values[1][0];
            const e = selectedMatrix.values[1][1];
            const f = selectedMatrix.values[1][2];
            const g = selectedMatrix.values[2][0];
            const h = selectedMatrix.values[2][1];
            const i = selectedMatrix.values[2][2];

            const secondCoeff = a * e + a * i + e * i - b * d - c * g - f * h;

            const leading = 'λ³';
            const quad = formatTerm(-trace, 2);
            const linear = formatTerm(secondCoeff, 1);
            const constant = formatTerm(-determinant, 0);
            return `${leading}${quad}${linear}${constant}`;
        };

        const charDiv = document.createElement('div');
        charDiv.className = 'eigenvalue-item char-equation-row';

        const charLabelDiv = document.createElement('div');
        charLabelDiv.className = 'eigenvalue-label';
        charLabelDiv.textContent = 'p(λ)';

        const charValueDiv = document.createElement('div');
        charValueDiv.className = 'eigenvalue-value eigenvector';
        charValueDiv.textContent = buildCharacteristicEquation();

        charDiv.appendChild(charLabelDiv);
        charDiv.appendChild(charValueDiv);
        valuesDiv.appendChild(charDiv);
        
        // Only show eigenvectors section if we have real eigenvectors
        const hasRealEigenvectors = eigendata.some(e => !e.isComplex && e.vector);
        
        if (hasRealEigenvectors) {
            // Add separator and eigenvectors header
            const separator = document.createElement('div');
            separator.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
            separator.style.margin = '8px 0';
            valuesDiv.appendChild(separator);
            
            // Add eigenvectors section title
            const eigenvectorsHeader = document.createElement('div');
            eigenvectorsHeader.className = 'eigenvalue-row eigenvalue-header';
            eigenvectorsHeader.innerHTML = '<span>Eigenvectors</span>';
            eigenvectorsHeader.style.marginTop = '0';
            eigenvectorsHeader.style.paddingTop = '0';
            eigenvectorsHeader.style.borderBottom = 'none';
            eigenvectorsHeader.style.paddingBottom = '4px';
            valuesDiv.appendChild(eigenvectorsHeader);
            
            // Display all eigenvectors (only for real eigenvalues)
            eigendata.forEach((eigen, index) => {
                if (eigen.isComplex || !eigen.vector) return;
                
                const vector = eigen.vector;
                const simplified = this.simplifyEigenvector(vector);
                
                const vecDiv = document.createElement('div');
                vecDiv.className = 'eigenvalue-item';
                
                const vecLabelDiv = document.createElement('div');
                vecLabelDiv.className = 'eigenvalue-label';
                vecLabelDiv.innerHTML = `v<sub>${index + 1}</sub>:`;
                
                const vecValueDiv = document.createElement('div');
                vecValueDiv.className = 'eigenvalue-value eigenvector';
                
                if (this.dimension === '2d') {
                    vecValueDiv.textContent = `(${formatNum(simplified.x)}, ${formatNum(simplified.y)})`;
                } else {
                    vecValueDiv.textContent = `(${formatNum(simplified.x)}, ${formatNum(simplified.y)}, ${formatNum(simplified.z)})`;
                }
                
                vecDiv.appendChild(vecLabelDiv);
                vecDiv.appendChild(vecValueDiv);
                valuesDiv.appendChild(vecDiv);
            });
        }
        
        // Only show invariant spaces controls if we have real eigenvectors
        if (hasRealEigenvectors) {
            // Add separator and invariant spaces controls
            const invariantSeparator = document.createElement('div');
            invariantSeparator.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
            invariantSeparator.style.margin = '12px 0 8px 0';
            valuesDiv.appendChild(invariantSeparator);
            
            // Invariant spaces header
            const invariantHeader = document.createElement('div');
            invariantHeader.className = 'eigenvalue-row eigenvalue-header';
            invariantHeader.innerHTML = '<span>Show eigenspaces</span>';
            invariantHeader.style.marginTop = '0';
            invariantHeader.style.paddingTop = '0';
            invariantHeader.style.borderBottom = 'none';
            invariantHeader.style.paddingBottom = '6px';
            valuesDiv.appendChild(invariantHeader);
            
            // Invariant display mode radio buttons
            const invariantControls = document.createElement('div');
            invariantControls.style.display = 'flex';
            invariantControls.style.gap = '8px';
            invariantControls.style.justifyContent = 'center';
            invariantControls.style.padding = '4px 0';
            
            const modes = [
                { value: 'off', label: 'Off' },
                { value: 'pulse', label: 'Pulse' },
                { value: 'solid', label: 'Solid' }
            ];
            
            modes.forEach(mode => {
                const btn = document.createElement('button');
                btn.className = 'invariant-mode-btn';
                btn.textContent = mode.label;
                btn.style.padding = '4px 12px';
                btn.style.fontSize = '11px';
                btn.style.cursor = 'pointer';
                btn.style.border = '1px solid rgba(255, 255, 255, 0.3)';
                btn.style.borderRadius = '4px';
                btn.style.background = this.invariantDisplayMode === mode.value ? 'rgba(100, 181, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)';
                btn.style.color = this.invariantDisplayMode === mode.value ? '#64B5F6' : 'rgba(255, 255, 255, 0.7)';
                btn.style.transition = 'all 0.2s ease';
                
                btn.addEventListener('click', () => {
                    this.invariantDisplayMode = mode.value;
                    this.visualizeInvariantSpaces(targetId);
                    // Update button styles
                    invariantControls.querySelectorAll('.invariant-mode-btn').forEach((b, i) => {
                        if (modes[i].value === mode.value) {
                            b.style.background = 'rgba(100, 181, 246, 0.3)';
                            b.style.color = '#64B5F6';
                        } else {
                            b.style.background = 'rgba(255, 255, 255, 0.05)';
                            b.style.color = 'rgba(255, 255, 255, 0.7)';
                        }
                    });
                });
                
                btn.addEventListener('mouseenter', () => {
                    if (this.invariantDisplayMode !== mode.value) {
                        btn.style.background = 'rgba(255, 255, 255, 0.1)';
                    }
                });
                
                btn.addEventListener('mouseleave', () => {
                    if (this.invariantDisplayMode !== mode.value) {
                        btn.style.background = 'rgba(255, 255, 255, 0.05)';
                    }
                });
                
                invariantControls.appendChild(btn);
            });
            
            valuesDiv.appendChild(invariantControls);
        }
    }

    updateVectorPanel() {
        const panel = document.getElementById('vector-info-panel');
        const contentDiv = document.getElementById('vector-info-content');
        const headerSpan = document.getElementById('vector-info-header');

        // Hide panel if no vector is specified
        if (!this.vectorInfoPanelId) {
            panel.style.display = 'none';
            return;
        }

        // Get the vector object
        const vector = this.vectors.find(v => v.id === this.vectorInfoPanelId);

        // If vector doesn't exist (was deleted), hide panel
        if (!vector) {
            panel.style.display = 'none';
            this.vectorInfoPanelId = null;
            return;
        }

        const formatAngle = (radians) => {
            return this.formatDisplayAngle(radians, 1);
        };

        const addPropertyRow = (container, property, value, valueClassName = '') => {
            const row = document.createElement('div');
            row.className = 'eigenvalue-item';

            const label = document.createElement('div');
            label.className = 'eigenvalue-label';
            label.textContent = `${property}:`;

            const val = document.createElement('div');
            val.className = `eigenvalue-value${valueClassName ? ` ${valueClassName}` : ''}`;
            val.textContent = value;

            row.appendChild(label);
            row.appendChild(val);
            container.appendChild(row);
            return { row, label, val };
        };

        // Update header with vector name
        headerSpan.textContent = `${vector.name || `V${vector.id}`}: Information`;
        panel.style.borderLeftColor = vector.color.getStyle();

        // Show panel and build content
        panel.style.display = 'block';
        contentDiv.innerHTML = '';

        const vectorValue = this.getVectorPointVector(vector);
        const magnitude = vectorValue.length();

        addPropertyRow(contentDiv, 'Magnitude', this.formatDisplayNumber(magnitude, 3));
        if (magnitude < 1e-10) {
            addPropertyRow(contentDiv, 'Unit vector', 'undefined (zero vector)');
        } else {
            const unit = vectorValue.clone().multiplyScalar(1 / magnitude);
            addPropertyRow(contentDiv, 'Unit vector', this.formatVectorComponents(unit), 'eigenvector');
        }

        const relationSeparator = document.createElement('div');
        relationSeparator.style.borderTop = '1px solid rgba(255, 255, 255, 0.2)';
        relationSeparator.style.margin = '8px 0';
        contentDiv.appendChild(relationSeparator);

        const otherVectors = this.vectors.filter(v => v.id !== vector.id && v.visible);
        if (otherVectors.length > 0) {
            const relationSection = document.createElement('div');

            const relationSelect = document.createElement('select');
            relationSelect.style.width = '100%';
            relationSelect.style.padding = '4px';
            relationSelect.style.fontSize = '11px';
            relationSelect.style.background = '#2A3F5A';
            relationSelect.style.color = 'white';
            relationSelect.style.border = '1px solid #555';
            relationSelect.style.borderRadius = '3px';
            relationSelect.style.cursor = 'pointer';

            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select vector --';
            relationSelect.appendChild(defaultOption);

            otherVectors.forEach(v => {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = v.name || `V${v.id}`;
                relationSelect.appendChild(option);
            });

            const savedSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'vector-vector' &&
                this.angleVisualizationState.vectorId === vector.id
                ? this.angleVisualizationState.otherVectorId
                : null;

            if (savedSelection && otherVectors.some(v => v.id === savedSelection)) {
                relationSelect.value = String(savedSelection);
            }

            const selectRow = addPropertyRow(relationSection, 'Compare with', '');
            selectRow.val.textContent = '';
            selectRow.val.appendChild(relationSelect);

            const relationResult = document.createElement('div');
            relationResult.style.display = 'none';
            relationSection.appendChild(relationResult);

            const updateRelationResult = (otherVectorId) => {
                if (!otherVectorId) {
                    relationResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                    return;
                }

                const otherVector = this.vectors.find(v => v.id === otherVectorId);
                if (!otherVector) return;

                const v1 = this.getVectorPointVector(vector);
                const v2 = this.getVectorPointVector(otherVector);
                const dot = v1.dot(v2);
                const angle = this.calculateVectorAngle(vector, otherVector);
                const v2LengthSq = v2.lengthSq();

                let projectionProperty = 'Projection';
                let projectionValue = 'undefined';
                if (v2LengthSq > 1e-10) {
                    const projection = v2.clone().multiplyScalar(dot / v2LengthSq);
                    projectionProperty = `Projection on ${otherVector.name || `V${otherVector.id}`}`;
                    projectionValue = this.formatVectorComponents(projection);
                }

                relationResult.innerHTML = '';

                addPropertyRow(relationResult, 'Dot product', this.formatDisplayNumber(dot, 3));
                addPropertyRow(relationResult, 'Angle', angle === null ? 'undefined' : formatAngle(angle));
                addPropertyRow(relationResult, projectionProperty, projectionValue, 'eigenvector');

                relationResult.style.display = 'block';
                this.angleVisualizationState = {
                    type: 'vector-vector',
                    vectorId: vector.id,
                    otherVectorId: otherVector.id
                };
                this.clearAngleVisualization();
            };

            relationSelect.addEventListener('change', (e) => {
                const selectedVectorId = e.target.value ? parseInt(e.target.value) : null;
                updateRelationResult(selectedVectorId);
            });

            if (relationSelect.value) {
                updateRelationResult(parseInt(relationSelect.value));
            }

            contentDiv.appendChild(relationSection);
        } else {
            const noVectorsMsg = document.createElement('div');
            noVectorsMsg.style.fontStyle = 'italic';
            noVectorsMsg.style.opacity = '0.7';
            noVectorsMsg.textContent = 'Add another vector to compare angle, dot product, and projection';
            contentDiv.appendChild(noVectorsMsg);
        }
    }

    updateLinePanel() {
        const panel = document.getElementById('line-info-panel');
        const contentDiv = document.getElementById('line-info-content');
        const headerSpan = document.getElementById('line-info-header');
        
        // Hide panel if no line is specified
        if (!this.lineInfoPanelId) {
            panel.style.display = 'none';
            return;
        }
        
        // Get the line object
        const line = this.lines.find(l => l.id === this.lineInfoPanelId);
        
        // If line doesn't exist (was deleted), hide panel
        if (!line) {
            const missingLineId = this.lineInfoPanelId;
            panel.style.display = 'none';
            this.lineInfoPanelId = null;

            // Only clear angle state if it depends on this missing line
            if (this.angleVisualizationState && (this.angleVisualizationState.lineId === missingLineId || this.angleVisualizationState.otherLineId === missingLineId)) {
                this.angleVisualizationState = null;
                this.clearAngleVisualization();
            }
            return;
        }
        
        // Update header with line name
        headerSpan.textContent = `${line.name}: Information`;
        panel.style.borderLeftColor = line.color;
        
        // Show panel and build content
        panel.style.display = 'block';
        contentDiv.innerHTML = '';
        
        // Helper function to format angles
        const formatAngle = (radians) => {
            return this.formatDisplayAngle(radians, 1);
        };

        const formatDistance = (distance) => {
            return this.formatDisplayNumber(distance, 3);
        };
        
        // Get other lines (excluding current one)
        const otherLines = this.lines.filter(l => l.id !== line.id && l.visible);

        // Keep line-angle and line-distance controls mutually exclusive
        let angleLineSelectRef = null;
        let angleLineResultRef = null;
        let angleLineBadgeRef = null;
        let distanceLineSelectRef = null;
        let distanceLineResultRef = null;
        let distancePointSelectRef = null;
        let distancePointResultRef = null;
        
        // Get all visible planes
        const visiblePlanes = this.planes.filter(p => p.visible);
        const visibleVectors = this.vectors.filter(v => v.visible);
        
        // Angle with other lines section
        if (otherLines.length > 0) {
            const lineSection = document.createElement('div');
            lineSection.style.padding = '8px';
            lineSection.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
            
            const lineLabel = document.createElement('div');
            lineLabel.textContent = 'Angle with line:';
            lineLabel.style.fontSize = '11px';
            lineLabel.style.marginBottom = '6px';
            lineLabel.style.opacity = '0.8';
            lineSection.appendChild(lineLabel);
            
            const lineSelect = document.createElement('select');
            lineSelect.style.width = '100%';
            lineSelect.style.padding = '4px';
            lineSelect.style.fontSize = '11px';
            lineSelect.style.background = '#2A3F5A';
            lineSelect.style.color = 'white';
            lineSelect.style.border = '1px solid #555';
            lineSelect.style.borderRadius = '3px';
            lineSelect.style.cursor = 'pointer';
            
            // Default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select line --';
            lineSelect.appendChild(defaultOption);
            
            // Add options for each line
            otherLines.forEach(l => {
                const option = document.createElement('option');
                option.value = l.id;
                option.textContent = l.name;
                lineSelect.appendChild(option);
            });

            const savedLineSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'line-line' &&
                this.angleVisualizationState.lineId === line.id
                ? this.angleVisualizationState.otherLineId
                : null;

            if (savedLineSelection && otherLines.some(l => l.id === savedLineSelection)) {
                lineSelect.value = String(savedLineSelection);
            }
            
            lineSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    // Reset distance selection/result when angle selection is made
                    if (distanceLineSelectRef) {
                        distanceLineSelectRef.value = '';
                    }
                    if (distanceLineResultRef) {
                        distanceLineResultRef.style.display = 'none';
                    }
                    if (distancePointSelectRef) {
                        distancePointSelectRef.value = '';
                    }
                    if (distancePointResultRef) {
                        distancePointResultRef.style.display = 'none';
                    }

                    const otherLine = this.lines.find(l => l.id === parseInt(e.target.value));
                    if (otherLine) {
                        const angle = this.calculateLineLineAngle(line, otherLine);
                        lineResult.textContent = formatAngle(angle);
                        lineResult.appendChild(lineRelationBadge);
                        lineResult.style.display = 'block';

                        const relationship = this.classifyLineRelationship(line, otherLine);
                        if (relationship === 'parallel') {
                            lineRelationBadge.textContent = 'Parallel';
                            lineRelationBadge.style.background = 'rgba(74, 144, 226, 0.25)';
                            lineRelationBadge.style.border = '1px solid rgba(74, 144, 226, 0.6)';
                            lineRelationBadge.style.color = '#64B5F6';
                            lineRelationBadge.style.display = 'inline-block';
                        } else if (relationship === 'skew') {
                            lineRelationBadge.textContent = 'Skew';
                            lineRelationBadge.style.background = 'rgba(243, 156, 18, 0.25)';
                            lineRelationBadge.style.border = '1px solid rgba(243, 156, 18, 0.6)';
                            lineRelationBadge.style.color = '#F39C12';
                            lineRelationBadge.style.display = 'inline-block';
                        } else {
                            lineRelationBadge.style.display = 'none';
                        }

                        this.angleVisualizationState = {
                            type: 'line-line',
                            lineId: line.id,
                            otherLineId: otherLine.id
                        };
                        this.updateAngleVisualization();
                    }
                } else {
                    lineResult.style.display = 'none';
                    lineRelationBadge.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                }
            });
            
            lineSection.appendChild(lineSelect);
            
            const lineResult = document.createElement('div');
            lineResult.style.marginTop = '6px';
            lineResult.style.fontSize = '13px';
            lineResult.style.fontWeight = 'bold';
            lineResult.style.color = '#64B5F6';
            lineResult.style.display = 'none';
            lineSection.appendChild(lineResult);

            const lineRelationBadge = document.createElement('span');
            lineRelationBadge.textContent = 'Skew';
            lineRelationBadge.style.display = 'none';
            lineRelationBadge.style.marginLeft = '8px';
            lineRelationBadge.style.padding = '1px 6px';
            lineRelationBadge.style.fontSize = '10px';
            lineRelationBadge.style.fontWeight = 'bold';
            lineRelationBadge.style.borderRadius = '999px';
            lineRelationBadge.style.background = 'rgba(243, 156, 18, 0.25)';
            lineRelationBadge.style.border = '1px solid rgba(243, 156, 18, 0.6)';
            lineRelationBadge.style.color = '#F39C12';
            lineResult.appendChild(lineRelationBadge);

            angleLineSelectRef = lineSelect;
            angleLineResultRef = lineResult;
            angleLineBadgeRef = lineRelationBadge;

            // Restore displayed result if this selection was already active
            if (lineSelect.value) {
                const selectedId = parseInt(lineSelect.value);
                const selectedLine = this.lines.find(l => l.id === selectedId);
                if (selectedLine) {
                    const angle = this.calculateLineLineAngle(line, selectedLine);
                    lineResult.textContent = formatAngle(angle);
                    lineResult.appendChild(lineRelationBadge);

                    const relationship = this.classifyLineRelationship(line, selectedLine);
                    if (relationship === 'parallel') {
                        lineRelationBadge.textContent = 'Parallel';
                        lineRelationBadge.style.background = 'rgba(74, 144, 226, 0.25)';
                        lineRelationBadge.style.border = '1px solid rgba(74, 144, 226, 0.6)';
                        lineRelationBadge.style.color = '#64B5F6';
                        lineRelationBadge.style.display = 'inline-block';
                    } else if (relationship === 'skew') {
                        lineRelationBadge.textContent = 'Skew';
                        lineRelationBadge.style.background = 'rgba(243, 156, 18, 0.25)';
                        lineRelationBadge.style.border = '1px solid rgba(243, 156, 18, 0.6)';
                        lineRelationBadge.style.color = '#F39C12';
                        lineRelationBadge.style.display = 'inline-block';
                    } else {
                        lineRelationBadge.style.display = 'none';
                    }

                    lineResult.style.display = 'block';
                }
            }
            
            contentDiv.appendChild(lineSection);
        }

        // Perpendicular distance to other lines section
        if (otherLines.length > 0) {
            const distanceSection = document.createElement('div');
            distanceSection.style.padding = '8px';
            distanceSection.style.borderBottom = '1px solid rgba(255,255,255,0.2)';

            const distanceLabel = document.createElement('div');
            distanceLabel.textContent = 'Distance to line:';
            distanceLabel.style.fontSize = '11px';
            distanceLabel.style.marginBottom = '6px';
            distanceLabel.style.opacity = '0.8';
            distanceSection.appendChild(distanceLabel);

            const distanceSelect = document.createElement('select');
            distanceSelect.style.width = '100%';
            distanceSelect.style.padding = '4px';
            distanceSelect.style.fontSize = '11px';
            distanceSelect.style.background = '#2A3F5A';
            distanceSelect.style.color = 'white';
            distanceSelect.style.border = '1px solid #555';
            distanceSelect.style.borderRadius = '3px';
            distanceSelect.style.cursor = 'pointer';

            const distanceDefaultOption = document.createElement('option');
            distanceDefaultOption.value = '';
            distanceDefaultOption.textContent = '-- Select line --';
            distanceSelect.appendChild(distanceDefaultOption);

            otherLines.forEach(l => {
                const option = document.createElement('option');
                option.value = l.id;
                option.textContent = l.name;
                distanceSelect.appendChild(option);
            });

            const savedDistanceSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'line-distance' &&
                this.angleVisualizationState.lineId === line.id
                ? this.angleVisualizationState.otherLineId
                : null;

            if (savedDistanceSelection && otherLines.some(l => l.id === savedDistanceSelection)) {
                distanceSelect.value = String(savedDistanceSelection);
            }

            const applyDistanceSelection = (selectedLineId) => {
                if (!selectedLineId) {
                    distanceResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                    return;
                }

                // Reset angle selection/result when distance selection is made
                if (angleLineSelectRef) {
                    angleLineSelectRef.value = '';
                }
                if (angleLineResultRef) {
                    angleLineResultRef.style.display = 'none';
                }
                if (angleLineBadgeRef) {
                    angleLineBadgeRef.style.display = 'none';
                }
                if (distancePointSelectRef) {
                    distancePointSelectRef.value = '';
                }
                if (distancePointResultRef) {
                    distancePointResultRef.style.display = 'none';
                }

                const otherLine = this.lines.find(l => l.id === selectedLineId);
                if (!otherLine) return;

                const distanceData = this.calculateLineToLineDistance(line, otherLine);
                if (!distanceData) return;

                distanceResult.textContent = formatDistance(distanceData.distance);
                distanceResult.style.display = 'block';
                this.angleVisualizationState = {
                    type: 'line-distance',
                    lineId: line.id,
                    otherLineId: otherLine.id
                };
                this.updateAngleVisualization();
            };

            distanceSelect.addEventListener('change', (e) => {
                const selectedLineId = e.target.value ? parseInt(e.target.value) : null;
                applyDistanceSelection(selectedLineId);
            });

            // Re-apply distance mode when clicking an already-selected option after switching modes
            distanceSelect.addEventListener('click', () => {
                if (!distanceSelect.value) return;

                const selectedLineId = parseInt(distanceSelect.value);
                const isAlreadyDistanceMode = this.angleVisualizationState &&
                    this.angleVisualizationState.type === 'line-distance' &&
                    this.angleVisualizationState.lineId === line.id &&
                    this.angleVisualizationState.otherLineId === selectedLineId;

                if (!isAlreadyDistanceMode) {
                    applyDistanceSelection(selectedLineId);
                }
            });

            distanceSection.appendChild(distanceSelect);

            const distanceResult = document.createElement('div');
            distanceResult.style.marginTop = '6px';
            distanceResult.style.fontSize = '13px';
            distanceResult.style.fontWeight = 'bold';
            distanceResult.style.color = '#64B5F6';
            distanceResult.style.display = 'none';
            distanceSection.appendChild(distanceResult);

            distanceLineSelectRef = distanceSelect;
            distanceLineResultRef = distanceResult;

            if (distanceSelect.value) {
                const selectedId = parseInt(distanceSelect.value);
                const selectedLine = this.lines.find(l => l.id === selectedId);
                if (selectedLine) {
                    const distanceData = this.calculateLineToLineDistance(line, selectedLine);
                    if (distanceData) {
                        distanceResult.textContent = formatDistance(distanceData.distance);
                        distanceResult.style.display = 'block';
                    }
                }
            }

            contentDiv.appendChild(distanceSection);
        }

        // Perpendicular distance to points section
        if (visibleVectors.length > 0) {
            const pointDistanceSection = document.createElement('div');
            pointDistanceSection.style.padding = '8px';
            pointDistanceSection.style.borderBottom = '1px solid rgba(255,255,255,0.2)';

            const pointDistanceLabel = document.createElement('div');
            pointDistanceLabel.textContent = 'Distance to point:';
            pointDistanceLabel.style.fontSize = '11px';
            pointDistanceLabel.style.marginBottom = '6px';
            pointDistanceLabel.style.opacity = '0.8';
            pointDistanceSection.appendChild(pointDistanceLabel);

            const pointDistanceSelect = document.createElement('select');
            pointDistanceSelect.style.width = '100%';
            pointDistanceSelect.style.padding = '4px';
            pointDistanceSelect.style.fontSize = '11px';
            pointDistanceSelect.style.background = '#2A3F5A';
            pointDistanceSelect.style.color = 'white';
            pointDistanceSelect.style.border = '1px solid #555';
            pointDistanceSelect.style.borderRadius = '3px';
            pointDistanceSelect.style.cursor = 'pointer';

            const pointDistanceDefaultOption = document.createElement('option');
            pointDistanceDefaultOption.value = '';
            pointDistanceDefaultOption.textContent = '-- Select point --';
            pointDistanceSelect.appendChild(pointDistanceDefaultOption);

            visibleVectors.forEach(v => {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = v.name;
                pointDistanceSelect.appendChild(option);
            });

            const savedPointDistanceSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'line-point-distance' &&
                this.angleVisualizationState.lineId === line.id
                ? this.angleVisualizationState.vectorId
                : null;

            if (savedPointDistanceSelection && visibleVectors.some(v => v.id === savedPointDistanceSelection)) {
                pointDistanceSelect.value = String(savedPointDistanceSelection);
            }

            const applyPointDistanceSelection = (selectedVectorId) => {
                if (!selectedVectorId) {
                    pointDistanceResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                    return;
                }

                // Reset other line relation controls when point distance selection is made
                if (angleLineSelectRef) {
                    angleLineSelectRef.value = '';
                }
                if (angleLineResultRef) {
                    angleLineResultRef.style.display = 'none';
                }
                if (angleLineBadgeRef) {
                    angleLineBadgeRef.style.display = 'none';
                }
                if (distanceLineSelectRef) {
                    distanceLineSelectRef.value = '';
                }
                if (distanceLineResultRef) {
                    distanceLineResultRef.style.display = 'none';
                }

                const vector = this.vectors.find(v => v.id === selectedVectorId);
                if (!vector) return;

                const distanceData = this.calculatePointToLineDistance(vector, line);
                if (!distanceData) return;

                pointDistanceResult.textContent = formatDistance(distanceData.distance);
                pointDistanceResult.style.display = 'block';
                this.angleVisualizationState = {
                    type: 'line-point-distance',
                    lineId: line.id,
                    vectorId: vector.id
                };
                this.updateAngleVisualization();
            };

            pointDistanceSelect.addEventListener('change', (e) => {
                const selectedVectorId = e.target.value ? parseInt(e.target.value) : null;
                applyPointDistanceSelection(selectedVectorId);
            });

            pointDistanceSelect.addEventListener('click', () => {
                if (!pointDistanceSelect.value) return;

                const selectedVectorId = parseInt(pointDistanceSelect.value);
                const isAlreadyPointDistanceMode = this.angleVisualizationState &&
                    this.angleVisualizationState.type === 'line-point-distance' &&
                    this.angleVisualizationState.lineId === line.id &&
                    this.angleVisualizationState.vectorId === selectedVectorId;

                if (!isAlreadyPointDistanceMode) {
                    applyPointDistanceSelection(selectedVectorId);
                }
            });

            pointDistanceSection.appendChild(pointDistanceSelect);

            const pointDistanceResult = document.createElement('div');
            pointDistanceResult.style.marginTop = '6px';
            pointDistanceResult.style.fontSize = '13px';
            pointDistanceResult.style.fontWeight = 'bold';
            pointDistanceResult.style.color = '#64B5F6';
            pointDistanceResult.style.display = 'none';
            pointDistanceSection.appendChild(pointDistanceResult);

            distancePointSelectRef = pointDistanceSelect;
            distancePointResultRef = pointDistanceResult;

            if (pointDistanceSelect.value) {
                const selectedId = parseInt(pointDistanceSelect.value);
                const selectedVector = this.vectors.find(v => v.id === selectedId);
                if (selectedVector) {
                    const distanceData = this.calculatePointToLineDistance(selectedVector, line);
                    if (distanceData) {
                        pointDistanceResult.textContent = formatDistance(distanceData.distance);
                        pointDistanceResult.style.display = 'block';
                    }
                }
            }

            contentDiv.appendChild(pointDistanceSection);
        }
        
        // Angle with planes section (only in 3D)
        if (this.dimension === '3d' && visiblePlanes.length > 0) {
            const planeSection = document.createElement('div');
            planeSection.style.padding = '8px';
            
            const planeLabel = document.createElement('div');
            planeLabel.textContent = 'Angle with plane:';
            planeLabel.style.fontSize = '11px';
            planeLabel.style.marginBottom = '6px';
            planeLabel.style.opacity = '0.8';
            planeSection.appendChild(planeLabel);
            
            const planeSelect = document.createElement('select');
            planeSelect.style.width = '100%';
            planeSelect.style.padding = '4px';
            planeSelect.style.fontSize = '11px';
            planeSelect.style.background = '#2A3F5A';
            planeSelect.style.color = 'white';
            planeSelect.style.border = '1px solid #555';
            planeSelect.style.borderRadius = '3px';
            planeSelect.style.cursor = 'pointer';
            
            // Default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select plane --';
            planeSelect.appendChild(defaultOption);
            
            // Add options for each plane
            visiblePlanes.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                planeSelect.appendChild(option);
            });

            const savedPlaneSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'line-plane' &&
                this.angleVisualizationState.lineId === line.id
                ? this.angleVisualizationState.planeId
                : null;

            if (savedPlaneSelection && visiblePlanes.some(p => p.id === savedPlaneSelection)) {
                planeSelect.value = String(savedPlaneSelection);
            }
            
            planeSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    const selectedPlane = this.planes.find(p => p.id === parseInt(e.target.value));
                    if (selectedPlane) {
                        const angle = this.calculatePlaneLineAngle(selectedPlane, line);
                        planeResult.textContent = formatAngle(angle);
                        planeResult.style.display = 'block';
                        this.angleVisualizationState = {
                            type: 'line-plane',
                            lineId: line.id,
                            planeId: selectedPlane.id
                        };
                        this.updateAngleVisualization();
                    }
                } else {
                    planeResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                }
            });
            
            planeSection.appendChild(planeSelect);
            
            const planeResult = document.createElement('div');
            planeResult.style.marginTop = '6px';
            planeResult.style.fontSize = '13px';
            planeResult.style.fontWeight = 'bold';
            planeResult.style.color = '#64B5F6';
            planeResult.style.display = 'none';
            planeSection.appendChild(planeResult);

            // Restore displayed result if this selection was already active
            if (planeSelect.value) {
                const selectedId = parseInt(planeSelect.value);
                const selectedPlane = this.planes.find(p => p.id === selectedId);
                if (selectedPlane) {
                    const angle = this.calculatePlaneLineAngle(selectedPlane, line);
                    planeResult.textContent = formatAngle(angle);
                    planeResult.style.display = 'block';
                }
            }
            
            contentDiv.appendChild(planeSection);
        }
        
        // No objects message
        if (otherLines.length === 0 && visibleVectors.length === 0 && (this.dimension === '2d' || visiblePlanes.length === 0)) {
            const noObjectsMsg = document.createElement('div');
            noObjectsMsg.style.padding = '8px';
            noObjectsMsg.style.fontStyle = 'italic';
            noObjectsMsg.style.opacity = '0.7';
            noObjectsMsg.textContent = this.dimension === '3d' ? 
                'Add other lines, planes, or vectors to calculate angles and distances' : 
                'Add other lines or vectors to calculate angles and distances';
            contentDiv.appendChild(noObjectsMsg);
        }
    }

    updatePlanePanel() {
        const panel = document.getElementById('plane-info-panel');
        const contentDiv = document.getElementById('plane-info-content');
        const headerSpan = document.getElementById('plane-info-header');
        
        // Hide panel if no plane is specified
        if (!this.planeInfoPanelId) {
            panel.style.display = 'none';
            return;
        }
        
        // Get the plane object
        const plane = this.planes.find(p => p.id === this.planeInfoPanelId);
        
        // If plane doesn't exist (was deleted), hide panel
        if (!plane) {
            const missingPlaneId = this.planeInfoPanelId;
            panel.style.display = 'none';
            this.planeInfoPanelId = null;

            // Only clear angle state if it depends on this missing plane
            if (this.angleVisualizationState && (this.angleVisualizationState.planeId === missingPlaneId || this.angleVisualizationState.otherPlaneId === missingPlaneId)) {
                this.angleVisualizationState = null;
                this.clearAngleVisualization();
            }
            return;
        }
        
        // Update header with plane name
        headerSpan.textContent = `${plane.name}: Information`;
        panel.style.borderLeftColor = plane.color;
        
        // Show panel and build content
        panel.style.display = 'block';
        contentDiv.innerHTML = '';
        
        // Helper function to format angles
        const formatAngle = (radians) => {
            return this.formatDisplayAngle(radians, 1);
        };

        const formatDistance = (distance) => {
            return this.formatDisplayNumber(distance, 3);
        };
        
        // Get other planes (excluding current one)
        const otherPlanes = this.planes.filter(p => p.id !== plane.id && p.visible);
        
        // Get all visible lines
        const visibleLines = this.lines.filter(l => l.visible);
        const visibleVectors = this.vectors.filter(v => v.visible);
        
        // Angle with other planes section
        if (otherPlanes.length > 0) {
            const planeSection = document.createElement('div');
            planeSection.style.padding = '8px';
            planeSection.style.borderBottom = '1px solid rgba(255,255,255,0.2)';
            
            const planeLabel = document.createElement('div');
            planeLabel.textContent = 'Angle with plane:';
            planeLabel.style.fontSize = '11px';
            planeLabel.style.marginBottom = '6px';
            planeLabel.style.opacity = '0.8';
            planeSection.appendChild(planeLabel);
            
            const planeSelect = document.createElement('select');
            planeSelect.style.width = '100%';
            planeSelect.style.padding = '4px';
            planeSelect.style.fontSize = '11px';
            planeSelect.style.background = '#2A3F5A';
            planeSelect.style.color = 'white';
            planeSelect.style.border = '1px solid #555';
            planeSelect.style.borderRadius = '3px';
            planeSelect.style.cursor = 'pointer';
            
            // Default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select plane --';
            planeSelect.appendChild(defaultOption);
            
            // Add options for each plane
            otherPlanes.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                planeSelect.appendChild(option);
            });

            const savedPlaneSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'plane-plane' &&
                this.angleVisualizationState.planeId === plane.id
                ? this.angleVisualizationState.otherPlaneId
                : null;

            if (savedPlaneSelection && otherPlanes.some(p => p.id === savedPlaneSelection)) {
                planeSelect.value = String(savedPlaneSelection);
            }
            
            planeSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    const otherPlane = this.planes.find(p => p.id === parseInt(e.target.value));
                    if (otherPlane) {
                        const angle = this.calculatePlanePlaneAngle(plane, otherPlane);
                        planeResult.textContent = formatAngle(angle);
                        planeResult.style.display = 'block';
                        this.angleVisualizationState = {
                            type: 'plane-plane',
                            planeId: plane.id,
                            otherPlaneId: otherPlane.id
                        };
                        this.updateAngleVisualization();
                    }
                } else {
                    planeResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                }
            });
            
            planeSection.appendChild(planeSelect);
            
            const planeResult = document.createElement('div');
            planeResult.style.marginTop = '6px';
            planeResult.style.fontSize = '13px';
            planeResult.style.fontWeight = 'bold';
            planeResult.style.color = '#64B5F6';
            planeResult.style.display = 'none';
            planeSection.appendChild(planeResult);

            // Restore displayed result if this selection was already active
            if (planeSelect.value) {
                const selectedId = parseInt(planeSelect.value);
                const selectedPlane = this.planes.find(p => p.id === selectedId);
                if (selectedPlane) {
                    const angle = this.calculatePlanePlaneAngle(plane, selectedPlane);
                    planeResult.textContent = formatAngle(angle);
                    planeResult.style.display = 'block';
                }
            }
            
            contentDiv.appendChild(planeSection);
        }
        
        // Angle with lines section
        if (visibleLines.length > 0) {
            const lineSection = document.createElement('div');
            lineSection.style.padding = '8px';
            
            const lineLabel = document.createElement('div');
            lineLabel.textContent = 'Angle with line:';
            lineLabel.style.fontSize = '11px';
            lineLabel.style.marginBottom = '6px';
            lineLabel.style.opacity = '0.8';
            lineSection.appendChild(lineLabel);
            
            const lineSelect = document.createElement('select');
            lineSelect.style.width = '100%';
            lineSelect.style.padding = '4px';
            lineSelect.style.fontSize = '11px';
            lineSelect.style.background = '#2A3F5A';
            lineSelect.style.color = 'white';
            lineSelect.style.border = '1px solid #555';
            lineSelect.style.borderRadius = '3px';
            lineSelect.style.cursor = 'pointer';
            
            // Default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select line --';
            lineSelect.appendChild(defaultOption);
            
            // Add options for each line
            visibleLines.forEach(l => {
                const option = document.createElement('option');
                option.value = l.id;
                option.textContent = l.name;
                lineSelect.appendChild(option);
            });

            const savedLineSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'line-plane' &&
                this.angleVisualizationState.planeId === plane.id
                ? this.angleVisualizationState.lineId
                : null;

            if (savedLineSelection && visibleLines.some(l => l.id === savedLineSelection)) {
                lineSelect.value = String(savedLineSelection);
            }
            
            lineSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    const selectedLine = this.lines.find(l => l.id === parseInt(e.target.value));
                    if (selectedLine) {
                        const angle = this.calculatePlaneLineAngle(plane, selectedLine);
                        lineResult.textContent = formatAngle(angle);
                        lineResult.style.display = 'block';
                        this.angleVisualizationState = {
                            type: 'line-plane',
                            lineId: selectedLine.id,
                            planeId: plane.id
                        };
                        this.updateAngleVisualization();
                    }
                } else {
                    lineResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                }
            });
            
            lineSection.appendChild(lineSelect);
            
            const lineResult = document.createElement('div');
            lineResult.style.marginTop = '6px';
            lineResult.style.fontSize = '13px';
            lineResult.style.fontWeight = 'bold';
            lineResult.style.color = '#64B5F6';
            lineResult.style.display = 'none';
            lineSection.appendChild(lineResult);

            // Restore displayed result if this selection was already active
            if (lineSelect.value) {
                const selectedId = parseInt(lineSelect.value);
                const selectedLine = this.lines.find(l => l.id === selectedId);
                if (selectedLine) {
                    const angle = this.calculatePlaneLineAngle(plane, selectedLine);
                    lineResult.textContent = formatAngle(angle);
                    lineResult.style.display = 'block';
                }
            }
            
            contentDiv.appendChild(lineSection);
        }

        // Perpendicular distance to points section
        if (visibleVectors.length > 0) {
            const pointDistanceSection = document.createElement('div');
            pointDistanceSection.style.padding = '8px';

            const pointDistanceLabel = document.createElement('div');
            pointDistanceLabel.textContent = 'Distance to point:';
            pointDistanceLabel.style.fontSize = '11px';
            pointDistanceLabel.style.marginBottom = '6px';
            pointDistanceLabel.style.opacity = '0.8';
            pointDistanceSection.appendChild(pointDistanceLabel);

            const pointDistanceSelect = document.createElement('select');
            pointDistanceSelect.style.width = '100%';
            pointDistanceSelect.style.padding = '4px';
            pointDistanceSelect.style.fontSize = '11px';
            pointDistanceSelect.style.background = '#2A3F5A';
            pointDistanceSelect.style.color = 'white';
            pointDistanceSelect.style.border = '1px solid #555';
            pointDistanceSelect.style.borderRadius = '3px';
            pointDistanceSelect.style.cursor = 'pointer';

            const pointDistanceDefaultOption = document.createElement('option');
            pointDistanceDefaultOption.value = '';
            pointDistanceDefaultOption.textContent = '-- Select point --';
            pointDistanceSelect.appendChild(pointDistanceDefaultOption);

            visibleVectors.forEach(v => {
                const option = document.createElement('option');
                option.value = v.id;
                option.textContent = v.name;
                pointDistanceSelect.appendChild(option);
            });

            const savedPointDistanceSelection = this.angleVisualizationState &&
                this.angleVisualizationState.type === 'plane-point-distance' &&
                this.angleVisualizationState.planeId === plane.id
                ? this.angleVisualizationState.vectorId
                : null;

            if (savedPointDistanceSelection && visibleVectors.some(v => v.id === savedPointDistanceSelection)) {
                pointDistanceSelect.value = String(savedPointDistanceSelection);
            }

            pointDistanceSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    const selectedVector = this.vectors.find(v => v.id === parseInt(e.target.value));
                    if (selectedVector) {
                        const distanceData = this.calculatePointToPlaneDistance(selectedVector, plane);
                        if (!distanceData) return;

                        pointDistanceResult.textContent = formatDistance(distanceData.distance);
                        pointDistanceResult.style.display = 'block';
                        this.angleVisualizationState = {
                            type: 'plane-point-distance',
                            planeId: plane.id,
                            vectorId: selectedVector.id
                        };
                        this.updateAngleVisualization();
                    }
                } else {
                    pointDistanceResult.style.display = 'none';
                    this.angleVisualizationState = null;
                    this.clearAngleVisualization();
                }
            });

            pointDistanceSection.appendChild(pointDistanceSelect);

            const pointDistanceResult = document.createElement('div');
            pointDistanceResult.style.marginTop = '6px';
            pointDistanceResult.style.fontSize = '13px';
            pointDistanceResult.style.fontWeight = 'bold';
            pointDistanceResult.style.color = '#64B5F6';
            pointDistanceResult.style.display = 'none';
            pointDistanceSection.appendChild(pointDistanceResult);

            if (pointDistanceSelect.value) {
                const selectedId = parseInt(pointDistanceSelect.value);
                const selectedVector = this.vectors.find(v => v.id === selectedId);
                if (selectedVector) {
                    const distanceData = this.calculatePointToPlaneDistance(selectedVector, plane);
                    if (distanceData) {
                        pointDistanceResult.textContent = formatDistance(distanceData.distance);
                        pointDistanceResult.style.display = 'block';
                    }
                }
            }

            contentDiv.appendChild(pointDistanceSection);
        }
        
        // No objects message
        if (otherPlanes.length === 0 && visibleLines.length === 0 && visibleVectors.length === 0) {
            const noObjectsMsg = document.createElement('div');
            noObjectsMsg.style.padding = '8px';
            noObjectsMsg.style.fontStyle = 'italic';
            noObjectsMsg.style.opacity = '0.7';
            noObjectsMsg.textContent = 'Add other planes, lines, or vectors to calculate angles and distances';
            contentDiv.appendChild(noObjectsMsg);
        }
    }

    calculatePlanePlaneAngle(plane1, plane2) {
        // Normal vectors
        const n1 = new THREE.Vector3(plane1.a, plane1.b, plane1.c);
        const n2 = new THREE.Vector3(plane2.a, plane2.b, plane2.c);
        
        // Normalize
        n1.normalize();
        n2.normalize();
        
        // Angle between normal vectors (use absolute value of dot product to get acute angle)
        const dot = Math.abs(n1.dot(n2));
        const angle = Math.acos(Math.min(1, dot)); // Clamp to avoid numerical errors
        
        return angle;
    }

    calculatePlaneLineAngle(plane, line) {
        // Normal vector of plane
        const normal = new THREE.Vector3(plane.a, plane.b, plane.c);
        normal.normalize();
        
        // Direction vector of line
        const direction = new THREE.Vector3(line.direction.x, line.direction.y, line.direction.z);
        direction.normalize();
        
        // Angle between line and plane is complement of angle between normal and direction
        // sin(angle_line_plane) = |cos(angle_normal_direction)| = |n · d|
        const dot = Math.abs(normal.dot(direction));
        const angle = Math.asin(Math.min(1, dot)); // Clamp to avoid numerical errors
        
        return angle;
    }

    calculateLineLineAngle(line1, line2) {
        // Direction vectors
        const d1 = new THREE.Vector3(line1.direction.x, line1.direction.y, line1.direction.z);
        const d2 = new THREE.Vector3(line2.direction.x, line2.direction.y, line2.direction.z);
        
        // Normalize
        d1.normalize();
        d2.normalize();
        
        // Angle between direction vectors (use absolute value of dot product to get acute angle)
        const dot = Math.abs(d1.dot(d2));
        const angle = Math.acos(Math.min(1, dot)); // Clamp to avoid numerical errors
        
        return angle;
    }

    calculateLineToLineDistance(line1, line2) {
        const p1 = this.getLinePointVector(line1);
        const p2 = this.getLinePointVector(line2);
        const d1 = this.getLineDirectionVector(line1);
        const d2 = this.getLineDirectionVector(line2);

        if (!p1 || !p2 || !d1 || !d2) return null;

        const epsilon = 1e-6;
        const r = p1.clone().sub(p2);
        const a = d1.dot(d1);
        const b = d1.dot(d2);
        const c = d2.dot(d2);
        const d = d1.dot(r);
        const e = d2.dot(r);
        const denominator = a * c - b * b;

        let s;
        let t;

        if (Math.abs(denominator) < epsilon) {
            // Parallel (or nearly parallel) lines
            s = 0;
            t = e / c;
        } else {
            s = (b * e - c * d) / denominator;
            t = (a * e - b * d) / denominator;
        }

        const closestPointOnLine1 = p1.clone().add(d1.clone().multiplyScalar(s));
        const closestPointOnLine2 = p2.clone().add(d2.clone().multiplyScalar(t));
        const connector = closestPointOnLine2.clone().sub(closestPointOnLine1);

        return {
            pointOnLine1: closestPointOnLine1,
            pointOnLine2: closestPointOnLine2,
            distance: connector.length()
        };
    }

    getVectorPointVector(vector) {
        const currentEnd = vector.currentEnd || vector.originalEnd;
        return new THREE.Vector3(currentEnd.x, currentEnd.y, currentEnd.z);
    }

    calculatePointToLineDistance(vector, line) {
        const point = this.getVectorPointVector(vector);
        const linePoint = this.getLinePointVector(line);
        const lineDirection = this.getLineDirectionVector(line);

        if (!point || !linePoint || !lineDirection) return null;

        const toPoint = point.clone().sub(linePoint);
        const projectionLength = toPoint.dot(lineDirection);
        const pointOnLine = linePoint.clone().add(lineDirection.clone().multiplyScalar(projectionLength));
        const connector = point.clone().sub(pointOnLine);

        return {
            point,
            pointOnLine,
            distance: connector.length()
        };
    }

    calculatePointToPlaneDistance(vector, plane) {
        const point = this.getVectorPointVector(vector);
        const a = plane.currentA !== undefined ? plane.currentA : plane.a;
        const b = plane.currentB !== undefined ? plane.currentB : plane.b;
        const c = plane.currentC !== undefined ? plane.currentC : plane.c;
        const d = plane.currentD !== undefined ? plane.currentD : plane.d;

        const normal = new THREE.Vector3(a, b, c);
        const normalLengthSq = normal.lengthSq();
        if (normalLengthSq < 1e-10) return null;

        const signedDistance = (normal.dot(point) - d) / Math.sqrt(normalLengthSq);
        const normalUnit = normal.clone().normalize();
        const pointOnPlane = point.clone().sub(normalUnit.clone().multiplyScalar(signedDistance));

        return {
            point,
            pointOnPlane,
            distance: Math.abs(signedDistance),
            normal: normalUnit
        };
    }

    calculateLineIntersectionOnXZ(line1, line2) {
        const p1 = this.getLinePointVector(line1);
        const p2 = this.getLinePointVector(line2);
        const d1 = this.getLineDirectionVector(line1);
        const d2 = this.getLineDirectionVector(line2);

        if (!p1 || !p2 || !d1 || !d2) return null;

        const det = d1.x * d2.z - d1.z * d2.x;
        if (Math.abs(det) < 1e-8) return null;

        const dx = p2.x - p1.x;
        const dz = p2.z - p1.z;
        const t = (dx * d2.z - dz * d2.x) / det;

        return new THREE.Vector3(
            p1.x + t * d1.x,
            0,
            p1.z + t * d1.z
        );
    }

    getLinePointVector(line) {
        const currentPoint = line.currentPoint || line.point;
        return new THREE.Vector3(currentPoint.x, currentPoint.y, currentPoint.z);
    }

    getLineDirectionVector(line) {
        const currentDirection = line.currentDirection || line.direction;
        const direction = new THREE.Vector3(currentDirection.x, currentDirection.y, currentDirection.z);
        if (direction.lengthSq() < 1e-10) return null;
        return direction.normalize();
    }

    getPlaneNormalVector(plane) {
        const a = plane.currentA !== undefined ? plane.currentA : plane.a;
        const b = plane.currentB !== undefined ? plane.currentB : plane.b;
        const c = plane.currentC !== undefined ? plane.currentC : plane.c;
        const normal = new THREE.Vector3(a, b, c);
        if (normal.lengthSq() < 1e-10) return null;
        return normal.normalize();
    }

    clearAngleVisualization() {
        if (!this.angleVisualization) return;

        this.angleVisualization.traverse(obj => {
            if (obj.geometry) {
                obj.geometry.dispose();
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(mat => {
                        if (mat.map) mat.map.dispose();
                        mat.dispose();
                    });
                } else {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            }
        });

        this.scene.remove(this.angleVisualization);
        this.angleVisualization = null;
    }

    createAngleRay(origin, direction, length, color, solidStyle = false) {
        const endPoint = origin.clone().add(direction.clone().multiplyScalar(length));

        if (solidStyle) {
            const rayRadius = Math.max(0.012, this.getArrowThickness().headWidth * 0.1);
            const ray = this.createDistanceConnector(origin, endPoint, color, rayRadius);
            if (!ray) return null;
            ray.mesh.renderOrder = 20;
            ray.mesh.material.depthTest = true;
            return ray.mesh;
        }

        const points = [origin.clone(), endPoint];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false
        });

        const ray = new THREE.Line(geometry, material);
        ray.renderOrder = 20;
        return ray;
    }

    createAngleArc(origin, startDirection, endDirection, angle, radius, color, solidStyle = false) {
        if (angle < 0.01) return null;

        const normal = new THREE.Vector3().crossVectors(startDirection, endDirection);
        if (normal.lengthSq() < 1e-10) return null;
        normal.normalize();

        const segmentCount = Math.max(12, Math.floor((angle / Math.PI) * 64));
        const points = [];

        for (let i = 0; i <= segmentCount; i++) {
            const t = i / segmentCount;
            const step = startDirection.clone().applyAxisAngle(normal, angle * t);
            points.push(origin.clone().add(step.multiplyScalar(radius)));
        }

        if (solidStyle) {
            const tubePath = new THREE.CatmullRomCurve3(points);
            const tubeRadius = Math.max(0.01, this.getArrowThickness().headWidth * 0.08);
            const geometry = new THREE.TubeGeometry(tubePath, Math.max(16, segmentCount * 2), tubeRadius, 10, false);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color(color),
                transparent: true,
                opacity: 0.95,
                depthTest: true,
                depthWrite: false
            });

            const arc = new THREE.Mesh(geometry, material);
            arc.renderOrder = 21;
            return arc;
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false
        });

        const arc = new THREE.Line(geometry, material);
        arc.renderOrder = 21;
        return arc;
    }

    createRightAngleMarker(vertex, directionA, directionB, size, color) {
        const dirA = directionA.clone().normalize();
        const dirB = directionB.clone().normalize();

        if (dirA.lengthSq() < 1e-10 || dirB.lengthSq() < 1e-10) return null;

        // Ensure directionB is perpendicular to directionA for a clean right-angle symbol
        const perpB = dirB.clone().sub(dirA.clone().multiplyScalar(dirB.dot(dirA)));
        if (perpB.lengthSq() < 1e-10) return null;
        perpB.normalize();

        const p1 = vertex.clone().add(dirA.clone().multiplyScalar(size));
        const p2 = p1.clone().add(perpB.clone().multiplyScalar(size));
        const p3 = vertex.clone().add(perpB.clone().multiplyScalar(size));

        const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2, p3]);
        const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false
        });

        const marker = new THREE.Line(geometry, material);
        marker.renderOrder = 1004;
        return marker;
    }

    createAngleTextLabel(text, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 96;
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = 'bold 48px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });
        material.color = new THREE.Color(color);

        const label = new THREE.Sprite(material);
        label.userData.screenHeightPx = 30;
        label.userData.aspectRatio = 1.8 / 0.7;
        label.onBeforeRender = (renderer, _scene, camera) => {
            this.updateSpriteToScreenSize(label, camera, renderer);
        };
        this.updateSpriteToScreenSize(label, this.camera, this.renderer);
        label.renderOrder = 1002;
        return label;
    }

    updateSpriteToScreenSize(sprite, camera, renderer) {
        if (!sprite || !camera || !renderer) return;

        const pixelHeight = sprite.userData?.screenHeightPx ?? 30;
        const aspectRatio = sprite.userData?.aspectRatio ?? 1;
        const worldHeight = this.getWorldHeightForPixelSize(pixelHeight, sprite.position, camera, renderer);
        sprite.scale.set(worldHeight * aspectRatio, worldHeight, 1);
    }

    getWorldHeightForPixelSize(pixelHeight, worldPosition, camera, renderer) {
        const viewportHeight = Math.max(1, renderer.domElement?.clientHeight || window.innerHeight || 1);

        let worldUnitsPerPixel = 0.01;
        if (camera.isPerspectiveCamera) {
            const distanceToCamera = Math.max(0.01, camera.position.distanceTo(worldPosition));
            const verticalFovRadians = THREE.MathUtils.degToRad(camera.fov);
            const visibleWorldHeight = 2 * Math.tan(verticalFovRadians / 2) * distanceToCamera;
            worldUnitsPerPixel = visibleWorldHeight / viewportHeight;
        } else if (camera.isOrthographicCamera) {
            const visibleWorldHeight = (camera.top - camera.bottom) / Math.max(0.0001, camera.zoom || 1);
            worldUnitsPerPixel = visibleWorldHeight / viewportHeight;
        }

        return Math.max(0.01, pixelHeight * worldUnitsPerPixel);
    }

    createDistanceConnector(startPoint, endPoint, color, radius) {
        const connectorDirection = endPoint.clone().sub(startPoint);
        const length = connectorDirection.length();
        if (length < 1e-6) return null;

        const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1, false);
        const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(color),
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false
        });

        const connectorMesh = new THREE.Mesh(geometry, material);
        connectorMesh.position.copy(startPoint).add(endPoint).multiplyScalar(0.5);

        const yAxis = new THREE.Vector3(0, 1, 0);
        connectorMesh.quaternion.setFromUnitVectors(yAxis, connectorDirection.normalize());
        connectorMesh.renderOrder = 1003;

        return { mesh: connectorMesh, material };
    }

    getAngleRainbowColor() {
        const hue = ((performance.now() / 1000) * this.angleRainbowSpeed) % 1;
        return new THREE.Color().setHSL(hue, 1.0, 0.5);
    }

    updateAngleVisualizationColorCycle() {
        if (!this.angleVisualization) return;

        const rainbow = this.getAngleRainbowColor();
        const cycleMaterials = this.angleVisualization.userData?.cycleMaterials || [];

        cycleMaterials.forEach(mat => {
            if (mat && mat.color) {
                mat.color.copy(rainbow);
            }
        });
    }

    updateAngleVisualization() {
        this.clearAngleVisualization();

        if (!this.angleVisualizationState) return;

        const state = this.angleVisualizationState;
        const overlayGroup = new THREE.Group();
        const overlayColor = this.getAngleRainbowColor();
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const radius = Math.max(0.6, distanceToTarget * 0.1);
        const rayLength = radius * 1.5;

        const cycleMaterials = [];

        let origin = new THREE.Vector3(0, 0, 0);
        let ray1Direction = null;
        let ray2Direction = null;
        let ray1Color = '#64B5F6';
        let ray2Color = '#64B5F6';
        let angle = 0;

        if (state.type === 'line-distance') {
            const line1 = this.lines.find(l => l.id === state.lineId && l.visible);
            const line2 = this.lines.find(l => l.id === state.otherLineId && l.visible);
            if (!line1 || !line2) {
                this.angleVisualizationState = null;
                return;
            }

            const distanceData = this.calculateLineToLineDistance(line1, line2);
            if (!distanceData) return;

            const { pointOnLine1, pointOnLine2, distance } = distanceData;
            const line1Direction = this.getLineDirectionVector(line1);
            const line2Direction = this.getLineDirectionVector(line2);
            if (!line1Direction || !line2Direction) return;

            const connectorDirection = pointOnLine2.clone().sub(pointOnLine1);
            if (connectorDirection.lengthSq() < 1e-12) return;
            connectorDirection.normalize();

            const connectorRadius = Math.max(0.014, this.getArrowThickness().headWidth * 0.12);
            const connector = this.createDistanceConnector(pointOnLine1, pointOnLine2, overlayColor, connectorRadius);
            if (!connector) return;
            overlayGroup.add(connector.mesh);
            cycleMaterials.push(connector.material);

            const markerRadius = Math.max(0.03, this.getArrowThickness().headWidth * 0.35);
            const markerGeometry = new THREE.SphereGeometry(markerRadius, 12, 12);
            const markerMaterial1 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: true });
            const markerMaterial2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: false });
            markerMaterial1.depthTest = false;
            const marker1 = new THREE.Mesh(markerGeometry, markerMaterial1);
            const marker2 = new THREE.Mesh(markerGeometry, markerMaterial2);
            marker1.position.copy(pointOnLine1);
            marker2.position.copy(pointOnLine2);
            marker1.renderOrder = 1004;
            marker2.renderOrder = 1004;
            overlayGroup.add(marker1);
            overlayGroup.add(marker2);
            cycleMaterials.push(markerMaterial1, markerMaterial2);

            const rightAngleSize = Math.min(
                Math.max(0.08, radius * 0.15),
                Math.max(0.05, distance * 0.35)
            );

            const rightAngle1 = this.createRightAngleMarker(
                pointOnLine1,
                line1Direction,
                connectorDirection,
                rightAngleSize,
                overlayColor
            );
            const rightAngle2 = this.createRightAngleMarker(
                pointOnLine2,
                line2Direction,
                connectorDirection.clone().multiplyScalar(-1),
                rightAngleSize,
                overlayColor
            );

            if (rightAngle1) {
                overlayGroup.add(rightAngle1);
                cycleMaterials.push(rightAngle1.material);
            }
            if (rightAngle2) {
                overlayGroup.add(rightAngle2);
                cycleMaterials.push(rightAngle2.material);
            }

            const midpoint = pointOnLine1.clone().add(pointOnLine2).multiplyScalar(0.5);
            const label = this.createAngleTextLabel(`d = ${this.formatDisplayNumber(distance, 3)}`, overlayColor);
            const cameraDirection = this.camera.position.clone().sub(midpoint).normalize();
            const offsetDirection = new THREE.Vector3().crossVectors(connectorDirection, cameraDirection);
            if (offsetDirection.lengthSq() < 1e-8) {
                offsetDirection.set(0, 1, 0);
            } else {
                offsetDirection.normalize();
            }
            if (offsetDirection.dot(cameraDirection) > 0) {
                offsetDirection.multiplyScalar(-1);
            }
            label.position.copy(midpoint).add(offsetDirection.multiplyScalar(Math.max(0.2, radius * 0.25)));
            overlayGroup.add(label);
            cycleMaterials.push(label.material);

            overlayGroup.userData.cycleMaterials = cycleMaterials;
            this.angleVisualization = overlayGroup;
            this.scene.add(this.angleVisualization);
            return;
        }

        if (state.type === 'line-point-distance') {
            const line = this.lines.find(l => l.id === state.lineId && l.visible);
            const vector = this.vectors.find(v => v.id === state.vectorId && v.visible);
            if (!line || !vector) {
                this.angleVisualizationState = null;
                return;
            }

            const distanceData = this.calculatePointToLineDistance(vector, line);
            if (!distanceData) return;

            const { point, pointOnLine, distance } = distanceData;
            const lineDirection = this.getLineDirectionVector(line);
            if (!lineDirection) return;

            const connectorDirection = point.clone().sub(pointOnLine);
            if (connectorDirection.lengthSq() < 1e-12) return;
            connectorDirection.normalize();

            const connectorRadius = Math.max(0.014, this.getArrowThickness().headWidth * 0.12);
            const connector = this.createDistanceConnector(pointOnLine, point, overlayColor, connectorRadius);
            if (!connector) return;
            overlayGroup.add(connector.mesh);
            cycleMaterials.push(connector.material);

            const markerRadius = Math.max(0.03, this.getArrowThickness().headWidth * 0.35);
            const markerGeometry = new THREE.SphereGeometry(markerRadius, 12, 12);
            const markerMaterial1 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: false });
            const markerMaterial2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: false });
            const marker1 = new THREE.Mesh(markerGeometry, markerMaterial1);
            const marker2 = new THREE.Mesh(markerGeometry, markerMaterial2);
            marker1.position.copy(pointOnLine);
            marker2.position.copy(point);
            marker1.renderOrder = 1004;
            marker2.renderOrder = 1004;
            overlayGroup.add(marker1);
            overlayGroup.add(marker2);
            cycleMaterials.push(markerMaterial1, markerMaterial2);

            const rightAngleSize = Math.min(
                Math.max(0.08, radius * 0.15),
                Math.max(0.05, distance * 0.35)
            );

            const rightAngle = this.createRightAngleMarker(
                pointOnLine,
                lineDirection,
                connectorDirection,
                rightAngleSize,
                overlayColor
            );

            if (rightAngle) {
                overlayGroup.add(rightAngle);
                cycleMaterials.push(rightAngle.material);
            }

            const midpoint = pointOnLine.clone().add(point).multiplyScalar(0.5);
            const label = this.createAngleTextLabel(`d = ${this.formatDisplayNumber(distance, 3)}`, overlayColor);
            const cameraDirection = this.camera.position.clone().sub(midpoint).normalize();
            const offsetDirection = new THREE.Vector3().crossVectors(connectorDirection, cameraDirection);
            if (offsetDirection.lengthSq() < 1e-8) {
                offsetDirection.set(0, 1, 0);
            } else {
                offsetDirection.normalize();
            }
            if (offsetDirection.dot(cameraDirection) > 0) {
                offsetDirection.multiplyScalar(-1);
            }
            label.position.copy(midpoint).add(offsetDirection.multiplyScalar(Math.max(0.2, radius * 0.25)));
            overlayGroup.add(label);
            cycleMaterials.push(label.material);

            overlayGroup.userData.cycleMaterials = cycleMaterials;
            this.angleVisualization = overlayGroup;
            this.scene.add(this.angleVisualization);
            return;
        }

        if (state.type === 'plane-point-distance') {
            const plane = this.planes.find(p => p.id === state.planeId && p.visible);
            const vector = this.vectors.find(v => v.id === state.vectorId && v.visible);
            if (!plane || !vector) {
                this.angleVisualizationState = null;
                return;
            }

            const distanceData = this.calculatePointToPlaneDistance(vector, plane);
            if (!distanceData) return;

            const { point, pointOnPlane, distance, normal } = distanceData;
            const connectorDirection = point.clone().sub(pointOnPlane);
            if (connectorDirection.lengthSq() < 1e-12) return;
            connectorDirection.normalize();

            const connectorRadius = Math.max(0.014, this.getArrowThickness().headWidth * 0.12);
            const connector = this.createDistanceConnector(pointOnPlane, point, overlayColor, connectorRadius);
            if (!connector) return;
            overlayGroup.add(connector.mesh);
            cycleMaterials.push(connector.material);

            const markerRadius = Math.max(0.03, this.getArrowThickness().headWidth * 0.35);
            const markerGeometry = new THREE.SphereGeometry(markerRadius, 12, 12);
            const markerMaterial1 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: false });
            const markerMaterial2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: false });
            const marker1 = new THREE.Mesh(markerGeometry, markerMaterial1);
            const marker2 = new THREE.Mesh(markerGeometry, markerMaterial2);
            marker1.position.copy(pointOnPlane);
            marker2.position.copy(point);
            marker1.renderOrder = 1004;
            marker2.renderOrder = 1004;
            overlayGroup.add(marker1);
            overlayGroup.add(marker2);
            cycleMaterials.push(markerMaterial1, markerMaterial2);

            const viewDirection = this.camera.position.clone().sub(pointOnPlane);
            const inPlaneDirection = viewDirection.sub(normal.clone().multiplyScalar(viewDirection.dot(normal)));
            if (inPlaneDirection.lengthSq() < 1e-10) {
                const fallbackAxis = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
                inPlaneDirection.copy(new THREE.Vector3().crossVectors(normal, fallbackAxis));
            }

            const rightAngleSize = Math.min(
                Math.max(0.08, radius * 0.15),
                Math.max(0.05, distance * 0.35)
            );

            const rightAngle = this.createRightAngleMarker(
                pointOnPlane,
                inPlaneDirection,
                connectorDirection,
                rightAngleSize,
                overlayColor
            );

            if (rightAngle) {
                overlayGroup.add(rightAngle);
                cycleMaterials.push(rightAngle.material);
            }

            const midpoint = pointOnPlane.clone().add(point).multiplyScalar(0.5);
            const label = this.createAngleTextLabel(`d = ${this.formatDisplayNumber(distance, 3)}`, overlayColor);
            const cameraDirection = this.camera.position.clone().sub(midpoint).normalize();
            const offsetDirection = new THREE.Vector3().crossVectors(connectorDirection, cameraDirection);
            if (offsetDirection.lengthSq() < 1e-8) {
                offsetDirection.set(0, 1, 0);
            } else {
                offsetDirection.normalize();
            }
            if (offsetDirection.dot(cameraDirection) > 0) {
                offsetDirection.multiplyScalar(-1);
            }
            label.position.copy(midpoint).add(offsetDirection.multiplyScalar(Math.max(0.2, radius * 0.25)));
            overlayGroup.add(label);
            cycleMaterials.push(label.material);

            overlayGroup.userData.cycleMaterials = cycleMaterials;
            this.angleVisualization = overlayGroup;
            this.scene.add(this.angleVisualization);
            return;
        }

        if (state.type === 'line-line') {
            const line1 = this.lines.find(l => l.id === state.lineId && l.visible);
            const line2 = this.lines.find(l => l.id === state.otherLineId && l.visible);
            if (!line1 || !line2) {
                this.angleVisualizationState = null;
                return;
            }

            const d1 = this.getLineDirectionVector(line1);
            const d2Raw = this.getLineDirectionVector(line2);
            if (!d1 || !d2Raw) return;

            const d2 = d2Raw.clone();
            if (d1.dot(d2) < 0) d2.multiplyScalar(-1);

            const intersection = this.calculateLineLineIntersection(line1, line2);
            if (intersection) {
                origin = intersection.clone();
            } else {
                const distanceData = this.calculateLineToLineDistance(line1, line2);
                if (distanceData) {
                    const midpoint = distanceData.pointOnLine1.clone().add(distanceData.pointOnLine2).multiplyScalar(0.5);
                    origin = midpoint;

                    // In top-down views, place skew-angle marker at where lines visually cross in XZ projection
                    const viewDirection = new THREE.Vector3();
                    this.camera.getWorldDirection(viewDirection);
                    const isTopDownView = Math.abs(viewDirection.y) > 0.85;
                    if (this.dimension === '3d' && isTopDownView) {
                        const projectedIntersectionXZ = this.calculateLineIntersectionOnXZ(line1, line2);
                        if (projectedIntersectionXZ) {
                            origin = projectedIntersectionXZ;
                            origin.y = midpoint.y;
                        }
                    }
                } else {
                    origin = this.getLinePointVector(line1);
                }
            }
            ray1Direction = d1;
            ray2Direction = d2;
            ray1Color = line1.color;
            ray2Color = line2.color;
            angle = Math.acos(Math.min(1, Math.abs(d1.dot(d2Raw))));
        } else if (state.type === 'line-plane') {
            const line = this.lines.find(l => l.id === state.lineId && l.visible);
            const plane = this.planes.find(p => p.id === state.planeId && p.visible);
            if (!line || !plane) {
                this.angleVisualizationState = null;
                return;
            }

            const normal = this.getPlaneNormalVector(plane);
            const lineDirection = this.getLineDirectionVector(line);
            if (!normal || !lineDirection) return;

            const direction = lineDirection.clone();
            if (direction.dot(normal) < 0) direction.multiplyScalar(-1);

            const projection = direction.clone().sub(normal.clone().multiplyScalar(direction.dot(normal)));
            if (projection.lengthSq() < 1e-10) {
                const fallbackAxis = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
                projection.copy(new THREE.Vector3().crossVectors(normal, fallbackAxis));
            }
            projection.normalize();

            const intersection = this.calculateLinePlaneIntersection(line, plane);
            origin = intersection ? intersection.clone() : this.getLinePointVector(line);
            ray1Direction = projection;
            ray2Direction = direction;
            ray1Color = plane.color;
            ray2Color = line.color;
            angle = Math.asin(Math.min(1, Math.abs(normal.dot(direction))));
        } else if (state.type === 'plane-plane') {
            const plane1 = this.planes.find(p => p.id === state.planeId && p.visible);
            const plane2 = this.planes.find(p => p.id === state.otherPlaneId && p.visible);
            if (!plane1 || !plane2) {
                this.angleVisualizationState = null;
                return;
            }

            const n1 = this.getPlaneNormalVector(plane1);
            const n2Raw = this.getPlaneNormalVector(plane2);
            if (!n1 || !n2Raw) return;

            const intersection = this.calculatePlanePlaneIntersection(plane1, plane2);
            if (intersection && intersection.point) {
                origin = new THREE.Vector3(intersection.point.x, intersection.point.y, intersection.point.z);
                const lineDirection = new THREE.Vector3(
                    intersection.direction.x,
                    intersection.direction.y,
                    intersection.direction.z
                ).normalize();

                // Dihedral section vectors: lie in each plane and are perpendicular to intersection line
                const section1 = new THREE.Vector3().crossVectors(lineDirection, n1).normalize();
                const section2Raw = new THREE.Vector3().crossVectors(lineDirection, n2Raw).normalize();
                if (section1.lengthSq() < 1e-10 || section2Raw.lengthSq() < 1e-10) return;

                const section2 = section2Raw.clone();
                if (section1.dot(section2) < 0) section2.multiplyScalar(-1);

                ray1Direction = section1;
                ray2Direction = section2;
                angle = Math.acos(Math.min(1, Math.abs(section1.dot(section2Raw))));
            } else if (plane1.mesh) {
                origin = plane1.mesh.position.clone();
                const n2 = n2Raw.clone();
                if (n1.dot(n2) < 0) n2.multiplyScalar(-1);
                ray1Direction = n1;
                ray2Direction = n2;
                angle = Math.acos(Math.min(1, Math.abs(n1.dot(n2Raw))));
            }
            ray1Color = plane1.color;
            ray2Color = plane2.color;
        }

        if (!ray1Direction || !ray2Direction) return;

        const useSolidAngleLines = state.type === 'line-line' || state.type === 'plane-plane';
        const ray1 = this.createAngleRay(origin, ray1Direction, rayLength, overlayColor, useSolidAngleLines);
        const ray2 = this.createAngleRay(origin, ray2Direction, rayLength, overlayColor, useSolidAngleLines);
        if (!ray1 || !ray2) return;
        overlayGroup.add(ray1);
        overlayGroup.add(ray2);
        cycleMaterials.push(ray1.material, ray2.material);

        const arc = this.createAngleArc(origin, ray1Direction, ray2Direction, angle, radius, overlayColor, useSolidAngleLines);
        if (arc) {
            overlayGroup.add(arc);
            cycleMaterials.push(arc.material);
        }

        const axis = new THREE.Vector3().crossVectors(ray1Direction, ray2Direction);
        let labelDirection = ray1Direction.clone();
        if (axis.lengthSq() > 1e-10 && angle > 0.001) {
            labelDirection = ray1Direction.clone().applyAxisAngle(axis.normalize(), angle * 0.5).normalize();
        }

        const label = this.createAngleTextLabel(this.formatDisplayAngle(angle, 1), overlayColor);
        label.position.copy(origin).add(labelDirection.multiplyScalar(radius * 1.3));
        overlayGroup.add(label);
        cycleMaterials.push(label.material);

        const thickness = this.getArrowThickness();
        const markerRadius = thickness.headWidth * 0.45;
        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(markerRadius, 12, 12),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(overlayColor), depthWrite: false, depthTest: true })
        );
        marker.position.copy(origin);
        marker.renderOrder = 22;
        overlayGroup.add(marker);
        cycleMaterials.push(marker.material);

        overlayGroup.userData.cycleMaterials = cycleMaterials;

        this.angleVisualization = overlayGroup;
        this.scene.add(this.angleVisualization);
    }

    animate() {
        if (this.isDestroyed) {
            return;
        }

        this.animationFrameId = requestAnimationFrame(() => this.animate());

        if (this.viewResetAnimation) {
            const now = performance.now();
            const elapsed = now - this.viewResetAnimation.startTime;
            const progress = Math.min(elapsed / this.viewResetAnimation.durationMs, 1);
            const eased = this.easeInOutCubic(progress);

            this.camera.position.lerpVectors(
                this.viewResetAnimation.startPosition,
                this.viewResetAnimation.endPosition,
                eased
            );

            this.controls.target.lerpVectors(
                this.viewResetAnimation.startTarget,
                this.viewResetAnimation.endTarget,
                eased
            );

            this.camera.quaternion.slerpQuaternions(
                this.viewResetAnimation.startQuaternion,
                this.viewResetAnimation.endQuaternion,
                eased
            );

            if (progress >= 1) {
                this.camera.position.copy(this.viewResetAnimation.endPosition);
                this.controls.target.copy(this.viewResetAnimation.endTarget);
                this.camera.quaternion.copy(this.viewResetAnimation.endQuaternion);
                this.viewResetAnimation = null;
                this.captureCurrentCameraState();
                this.scheduleStateSave();
            }
        }

        this.controls.update();
        
        // Skip expensive updates during interaction to improve mobile performance
        // These will run again once interaction stops
        if (!this.isInteracting) {
            this.updateAxesLength();
            this.updateGridSpacing();
            this.updateNumberLabelScales();
            this.updatePointSphereScales();
            this.updateVectorThickness();
        }

        this.updateInvariantSpaceColors();
        this.updateAngleVisualizationColorCycle();
        this.updateIntersectionVisualizationColorCycle();
        if (!this.isDestroyed && this.renderer) {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

// App will be initialized when Start button is clicked (see title screen code above)