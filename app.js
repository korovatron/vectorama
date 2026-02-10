import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Title Screen Functionality
const titleScreen = document.getElementById('title-screen');
const mainApp = document.getElementById('main-app');
const startBtn = document.getElementById('start-btn');

let appInitialized = false;

startBtn.addEventListener('click', () => {
    titleScreen.classList.add('hidden');
    mainApp.style.display = 'block';
    
    // Initialize the app only after the container is visible
    if (!appInitialized) {
        const app = new VectoramaApp();
        window.vectoramaApp = app;
        appInitialized = true;
    }
});

// Allow space bar to start the app from title screen
// Allow ESC to return to title screen
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !appInitialized) {
        e.preventDefault(); // Prevent page scroll
        titleScreen.classList.add('hidden');
        mainApp.style.display = 'block';
        
        const app = new VectoramaApp();
        window.vectoramaApp = app;
        appInitialized = true;
    } else if (e.code === 'Escape' && appInitialized) {
        // Return to title screen
        titleScreen.classList.remove('hidden');
        mainApp.style.display = 'none';
        appInitialized = false;
        
        // Clean up the app instance if needed
        if (window.vectoramaApp && window.vectoramaApp.cleanup) {
            window.vectoramaApp.cleanup();
        }
        window.vectoramaApp = null;
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
        
        this.isAnimating = false;
        this.animationSpeed = 2.0;
        this.isDragging = false;
        this.axisLengthX = 100; // Dynamic X axis length
        this.axisLengthY = 100; // Dynamic Y axis length
        this.axisLengthZ = 100; // Dynamic Z axis length
        this.lastCameraDistance = 0; // Track camera distance for vector thickness updates
        this.tempArrow = null;
        this.gridVisible = true; // Grid visibility state
        this.currentGridSpacing = 1; // Current grid spacing
        this.isResizing = false; // Flag to prevent animation loop interference
        this.resizeTimeout = null; // For debouncing
        this.updateTimeout = null; // For debouncing grid/axes updates during zoom
        this.lastUpdateTime = 0; // Track last update time for throttling
        
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
        this.vectorDisplayMode = 'points'; // 'vectors', 'points', 'path'
        this.pathLines = []; // Store path visualization lines
        this.intersectionMarkers = []; // Store line-plane intersection markers
        this.planeIntersectionLines = []; // Store plane-plane intersection lines
        
        // Unique ID counters
        this.nextVectorId = 1;
        this.nextMatrixId = 1;
        this.nextLineId = 1;
        this.nextPlaneId = 1;
        
        // Google Analytics tracking
        this.lastAnalyticsEvent = 0;
        this.lastPanelEvent = 0;
        this.analyticsThrottleMs = 30000; // Send event max once per 30 seconds
        
        this.panelOpen = true; // Panel open by default
        this.initThreeJS();
        this.initEventListeners();
        this.createGrid();
        this.createAxes();
        this.animate();
        
        // Initialize with default content
        this.initializeDefaultContent();
        
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

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas,
            antialias: true,
            logarithmicDepthBuffer: true
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.15;
        this.controls.enableRotate = false; // Start in 2D mode with rotation disabled
        
        // Set zoom limits to prevent extreme zoom levels
        this.controls.minDistance = 1;   // Prevent zooming too close
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
        window.addEventListener('resize', () => {
            this.onWindowResize();
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
            this.gridHelper.position.z = -0.01;
            this.gridHelper.visible = this.gridVisible;
            
            // Make grid transparent like 3D grid lines
            this.gridHelper.material.transparent = true;
            this.gridHelper.material.opacity = 0.5;
            
            this.scene.add(this.gridHelper);
            
            // Add axis numbers for 2D mode
            // Clamp to axis limits (-100 to +100)
            const labelOffset = distanceToTarget * 0.03; // Fixed screen-space offset
            const maxRange = Math.floor(100 / spacing);
            const range = Math.min(Math.ceil(size / 2 / spacing), maxRange);
            
            // Get theme-appropriate colors for axis labels
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isLight = currentTheme === 'light';
            const xColor = isLight ? '#cc0000' : '#ff3333'; // Darker red in light mode
            const yColor = isLight ? '#009900' : '#33ff33'; // Darker green in light mode
            
            for (let i = -range; i <= range; i++) {
                if (i === 0) continue; // Skip origin
                const value = i * spacing;
                
                // X axis numbers (below the axis) - red for x-axis
                const xLabel = this.createNumberLabel(value, xColor);
                xLabel.position.set(value, -labelOffset, 0);
                xLabel.userData = { axis: 'x', value: value };
                this.axisNumbers.add(xLabel);
                
                // Y axis numbers (left of the axis) - green for y-axis
                const yLabel = this.createNumberLabel(value, yColor);
                yLabel.position.set(-labelOffset, value, 0);
                yLabel.userData = { axis: 'y', value: value };
                this.axisNumbers.add(yLabel);
            }
            
            this.axisNumbers.visible = this.gridVisible;
            this.scene.add(this.axisNumbers);
        } else {
            // 3D: Create grid plane at y=0 (XZ plane - ground)
            this.gridHelper = new THREE.Group();
            const gridSize = 30; // Grid extent
            const halfGridSize = gridSize / 2;
            const halfSize = (gridSize * spacing) / 2;
            
            const lineMaterial = new THREE.LineBasicMaterial({ 
                color: 0x888888,
                transparent: true,
                opacity: 0.5
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
            // Clamp to axis limits (-100 to +100)
            const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
            const labelOffset = distanceToTarget * 0.03; // Fixed screen-space offset
            const maxRange = Math.floor(100 / spacing);
            const range = maxRange;
            
            // Get theme-appropriate colors for axis labels
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const isLight = currentTheme === 'light';
            const xColor = isLight ? '#cc0000' : '#ff3333'; // Darker red in light mode
            const yColor = isLight ? '#009900' : '#33ff33'; // Darker green in light mode
            const zColor = isLight ? '#0000cc' : '#3333ff'; // Darker blue in light mode
            
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
        
        // Keep background transparent (don't fill with white)
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        context.fillStyle = color;
        context.font = 'bold 80px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
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
        const scale = distanceToTarget * 0.05;
        sprite.scale.set(scale * 2, scale, 1); // Wider aspect ratio for numbers
        
        return sprite;
    }

    getArrowThickness() {
        // Calculate thickness based on camera distance to target (zoom level), not origin
        // This prevents thickness changes when panning
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const thicknessScale = distanceToTarget * 0.06; // Increased for better visibility
        return {
            headLength: 0.5 * thicknessScale,
            headWidth: 0.25 * thicknessScale
        };
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
            depthWrite: true,
            depthTest: true
        });
        
        const cylinder = new THREE.Mesh(geometry, material);
        
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
        // Create arrow with higher quality geometry to prevent gaps and flickering
        const group = new THREE.Group();
        
        // Cap head dimensions to be proportional to vector length to prevent oversized heads on short vectors
        const maxHeadLength = length * 0.25;
        const cappedHeadLength = Math.min(headLength, maxHeadLength);
        
        // Cap head width (cone radius) to be proportional to vector length as well
        const maxHeadWidth = length * 0.125; // 12.5% of vector length
        const cappedHeadWidth = Math.min(headWidth, maxHeadWidth);
        
        const shaftLength = length - cappedHeadLength;
        const shaftRadius = cappedHeadWidth * 0.3;
        
        // In 2D mode, use triangular geometry; in 3D mode, use circular
        const radialSegments = this.dimension === '2d' ? 3 : 16;
        
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
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const shaft = new THREE.Mesh(shaftGeometry, material);
        shaft.position.copy(direction.clone().multiplyScalar(shaftLength / 2));
        
        // Orient shaft along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());
        shaft.quaternion.copy(quaternion);
        
        // Head - cone with segments based on mode (triangle in 2D, circle in 3D)
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
        group.renderOrder = 1; // Render after axes (which have default renderOrder of 0)
        
        return group;
    }

    createSmoothArrowHead(direction, position, color, headLength = 0.2, headWidth = 0.1) {
        // Create just an arrow head at a specific position along the direction
        const radialSegments = this.dimension === '2d' ? 3 : 16;
        
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
        // Add unit square vectors
        this.addVector(0, 0, 0);
        this.addVector(1, 0, 0);
        this.addVector(1, 1, 0);
        this.addVector(0, 1, 0);
        
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
        
        cubeVertices.forEach(coords => {
            const colorHex = this.vectorColors[this.colorIndex3D % this.vectorColors.length];
            this.colorIndex3D++;
            
            const vector3D = {
                arrow: null,
                pointSphere: null,
                originalEnd: new THREE.Vector3(coords[0], coords[1], coords[2]),
                currentEnd: new THREE.Vector3(coords[0], coords[1], coords[2]),
                color: new THREE.Color(colorHex),
                id: this.nextVectorId++,
                visible: true
            };
            this.vectors3D.push(vector3D);
        });
        
        // Update the display for 2D mode
        this.updateObjectsList();
    }

    initEventListeners() {
        // Panel toggle button
        const panelToggleBtn = document.getElementById('panel-toggle-btn');
        const controlPanel = document.querySelector('.control-panel');
        
        // Track panel interactions for analytics
        if (controlPanel) {
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
            
            controlPanel.addEventListener('click', () => trackPanelInteraction(), { passive: true });
            controlPanel.addEventListener('touchstart', (e) => {
                trackPanelInteraction();
                e.stopPropagation(); // Prevent bubbling to prevent iOS rubber banding in PWA mode
            }, { passive: true });
            
            // Prevent touch events from bubbling to prevent iOS rubber banding in PWA mode
            controlPanel.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            }, { passive: true });
            
            controlPanel.addEventListener('touchend', (e) => {
                e.stopPropagation();
            }, { passive: true });
        }
        
        panelToggleBtn.addEventListener('click', () => {
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
        });
        
        // Auto-close panel on canvas tap for narrow touch devices (phones in portrait)
        this.canvas.addEventListener('touchstart', (e) => {
            // Exclude touches that start on control panel to prevent rubber banding
            if (e.target.closest('.control-panel')) {
                return;
            }
            
            // Only on narrow screens (phones) and when panel is open
            if (window.innerWidth < 768 && this.panelOpen) {
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
        }, { passive: true });
        
        // Top button row - Reset axes
        document.getElementById('reset-axes-btn').addEventListener('click', () => this.resetView());
        
        // Top button row - Add button opens dropdown
        document.getElementById('add-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('add-dropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        });
        
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
            });
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            document.getElementById('add-dropdown').style.display = 'none';
        });
        
        // Second button row - Grid toggle
        document.getElementById('grid-toggle-btn').addEventListener('click', () => this.toggleGrid());
        
        // Second button row - Dimension toggle
        document.getElementById('dimension-toggle-btn').addEventListener('click', () => this.toggleDimension());
        
        // Third button row - Vector display mode toggle
        document.getElementById('vector-display-toggle-btn').addEventListener('click', () => this.toggleVectorDisplayMode());

        // Canvas drag to add vectors
        this.canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onCanvasMouseUp(e));
        
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Matrix input changes
        this.addMatrixInputListeners();
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
            });
        });
    }

    switchDimension(dimension) {
        // Save old dimension before changing
        const oldDimension = this.dimension;
        
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
        
        // Show/hide appropriate vector presets
        document.querySelectorAll('.preset-2d').forEach(el => {
            el.style.display = dimension === '2d' ? 'block' : 'none';
        });
        document.querySelectorAll('.preset-3d').forEach(el => {
            el.style.display = dimension === '3d' ? 'block' : 'none';
        });

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

        this.controls.update();
        
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
            this.usedMatrixLetters2D = this.usedMatrixLetters;
            this.selectedMatrixId2D = this.selectedMatrixId;
            this.colorIndex2D = this.colorIndex;
        } else {
            this.vectors3D = this.vectors;
            this.matrices3D = this.matrices;
            this.lines3D = this.lines;
            this.planes3D = this.planes;
            this.usedMatrixLetters3D = this.usedMatrixLetters;
            this.selectedMatrixId3D = this.selectedMatrixId;
            this.colorIndex3D = this.colorIndex;
        }
        
        // Clear current visualizations from scene
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
        });
        this.lines.forEach(line => {
            if (line.mesh) this.scene.remove(line.mesh);
        });
        this.planes.forEach(plane => {
            if (plane.mesh) this.scene.remove(plane.mesh);
        });
        this.pathLines.forEach(line => this.scene.remove(line));
        this.pathLines = [];
        
        // Swap to the new dimension's data
        if (dimension === '2d') {
            this.vectors = this.vectors2D;
            this.matrices = this.matrices2D;
            this.lines = this.lines2D;
            this.planes = []; // No planes in 2D
            this.usedMatrixLetters = this.usedMatrixLetters2D;
            this.selectedMatrixId = this.selectedMatrixId2D;
            this.colorIndex = this.colorIndex2D;
        } else {
            this.vectors = this.vectors3D;
            this.matrices = this.matrices3D;
            this.lines = this.lines3D;
            this.planes = this.planes3D;
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
                
                const thickness = this.getArrowThickness();
                vec.arrow = this.createSmoothArrow(
                    direction,
                    origin,
                    length,
                    vec.color,
                    thickness.headLength,
                    thickness.headWidth
                );
                
                // Create point sphere
                const pointSize = 0.15;
                const sphereGeometry = new THREE.SphereGeometry(pointSize, 16, 16);
                const sphereMaterial = new THREE.MeshBasicMaterial({ 
                    color: vec.color,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1
                });
                vec.pointSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
                vec.pointSphere.position.copy(new THREE.Vector3(x, y, z));
                vec.pointSphere.renderOrder = 1;
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
    }

    resetView() {
        // Reset camera to default position for current dimension
        if (this.dimension === '2d') {
            this.camera.position.set(0, 0, 10);
            this.camera.lookAt(0, 0, 0);
        } else {
            this.camera.position.set(3, 3, 3);
            this.camera.lookAt(0, 0, 0);
        }
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    toggleGrid() {
        this.gridVisible = !this.gridVisible;
        
        if (this.gridHelper) {
            this.gridHelper.visible = this.gridVisible;
        }
        
        // Update icon active states
        const gridOff = document.getElementById('grid-off');
        const gridOn = document.getElementById('grid-on');
        if (gridOff && gridOn) {
            if (this.gridVisible) {
                gridOff.classList.remove('grid-active');
                gridOn.classList.add('grid-active');
            } else {
                gridOn.classList.remove('grid-active');
                gridOff.classList.add('grid-active');
            }
        }
    }
    
    toggleDimension() {
        // Toggle between 2D and 3D
        const newDimension = this.dimension === '2d' ? '3d' : '2d';
        this.switchDimension(newDimension);
    }

    toggleVectorDisplayMode() {
        // Cycle through: vectors -> points -> path -> vectors
        const modes = ['vectors', 'points', 'path'];
        const currentIndex = modes.indexOf(this.vectorDisplayMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        this.vectorDisplayMode = modes[nextIndex];
        
        // Update button active states
        const vecArrow = document.getElementById('vec-arrow');
        const vecPoint = document.getElementById('vec-point');
        const vecPath = document.getElementById('vec-path');
        if (vecArrow && vecPoint && vecPath) {
            vecArrow.classList.remove('vec-active');
            vecPoint.classList.remove('vec-active');
            vecPath.classList.remove('vec-active');
            
            if (this.vectorDisplayMode === 'vectors') {
                vecArrow.classList.add('vec-active');
            } else if (this.vectorDisplayMode === 'points') {
                vecPoint.classList.add('vec-active');
            } else if (this.vectorDisplayMode === 'path') {
                vecPath.classList.add('vec-active');
            }
        }
        
        // Update vector visualization
        this.updateVectorDisplay();
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
                const x = Math.round(intersectPoint.x);
                const y = Math.round(intersectPoint.y);
                this.updateTempVector(x, y, 0);
            }
        } else {
            // XZ plane (y = 0) for 3D mode
            plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            this.raycaster.ray.intersectPlane(plane, intersectPoint);
            if (intersectPoint) {
                // Snap to grid for preview
                const x = Math.round(intersectPoint.x);
                const y = Math.round(intersectPoint.y);
                const z = Math.round(intersectPoint.z);
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
                // Snap to grid (1 unit spacing)
                const x = Math.round(intersectPoint.x);
                const y = Math.round(intersectPoint.y);
                
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
                // Snap to grid (1 unit spacing)
                const x = Math.round(intersectPoint.x);
                const y = Math.round(intersectPoint.y);
                const z = Math.round(intersectPoint.z);
                
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
            
            const thickness = this.getArrowThickness();
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
        
        const thickness = this.getArrowThickness();
        const arrow = this.createSmoothArrow(
            direction,
            origin,
            length,
            color,
            thickness.headLength,
            thickness.headWidth
        );

        // Create point sphere for points mode
        const pointSize = 0.15;
        const sphereGeometry = new THREE.SphereGeometry(pointSize, 16, 16);
        const sphereMaterial = new THREE.MeshBasicMaterial({ 
            color: color,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const pointSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        pointSphere.position.copy(new THREE.Vector3(x, y, z));
        pointSphere.renderOrder = 1; // Render after axes

        const vector = {
            arrow: arrow,
            pointSphere: pointSphere,
            originalEnd: new THREE.Vector3(x, y, z),
            currentEnd: new THREE.Vector3(x, y, z),
            color: color,
            id: this.nextVectorId++,
            visible: true
        };

        this.vectors.push(vector);
        
        // Add appropriate visualization based on current mode
        this.updateVectorDisplay();
        this.updateObjectsList();
    }

    updateVectorList() {
        this.updateObjectsList();
    }
    
    updateVectorDisplay() {
        // Remove all current visualizations
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
        });
        
        // Clear path lines
        this.pathLines.forEach(line => this.scene.remove(line));
        this.pathLines = [];
        
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
                    this.scene.add(vec.pointSphere);
                }
            });
        } else if (this.vectorDisplayMode === 'path') {
            // Show points and connecting lines for visible vectors
            const visibleVectors = this.vectors.filter(v => v.visible);
            
            visibleVectors.forEach(vec => {
                if (vec.pointSphere) {
                    this.scene.add(vec.pointSphere);
                }
            });
            
            // Create lines connecting the points in sequence using cylinders (same as axes)
            if (visibleVectors.length > 1) {
                const thickness = this.getArrowThickness();
                const lineRadius = thickness.headWidth * 0.15; // Same thickness as axes
                const radialSegments = this.dimension === '2d' ? 3 : 16;
                
                for (let i = 0; i < visibleVectors.length; i++) {
                    const startVec = visibleVectors[i];
                    const endVec = visibleVectors[(i + 1) % visibleVectors.length]; // Wrap around to first
                    
                    const start = startVec.currentEnd.clone();
                    const end = endVec.currentEnd.clone();
                    
                    // Create cylinder line
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
                        color: startVec.color,
                        depthWrite: true,
                        depthTest: true,
                        polygonOffset: true,
                        polygonOffsetFactor: -1,
                        polygonOffsetUnits: -1
                    });
                    
                    const cylinder = new THREE.Mesh(geometry, material);
                    cylinder.renderOrder = 1; // Render after axes
                    
                    // Position at midpoint
                    const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                    cylinder.position.copy(midpoint);
                    
                    // Orient along direction
                    const axis = new THREE.Vector3(0, 1, 0);
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction);
                    cylinder.quaternion.copy(quaternion);
                    
                    this.pathLines.push(cylinder);
                    this.scene.add(cylinder);
                }
            }
        }
    }
    
    updateObjectsList() {
        const container = document.getElementById('objects-container');
        container.innerHTML = '';

        // Render matrices first
        this.matrices.forEach(matrix => {
            this.renderMatrixItem(container, matrix);
        });

        // Render planes second (3D only)
        if (this.dimension === '3d') {
            this.planes.forEach(plane => {
                this.renderPlaneItem(container, plane);
            });
        }

        // Render lines third
        this.lines.forEach(line => {
            this.renderLineItem(container, line);
        });

        // Then render vectors last
        this.vectors.forEach(vec => {
            this.renderVectorItem(container, vec);
        });
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
        // Hide '=' sign on mobile to save space
        const isMobile = window.innerWidth < 768;
        nameSpan.textContent = isMobile ? matrix.name : matrix.name + ' =';
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
        equationSpan.textContent = 'r = a + tb';
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
        
        // Row 1: [a]x + [b]y +
        const row1 = document.createElement('div');
        row1.style.display = 'flex';
        row1.style.gap = '4px';
        row1.style.alignItems = 'center';
        
        // Coefficient a
        const aInput = document.createElement('input');
        aInput.type = 'number';
        aInput.step = '0.1';
        aInput.value = formatNum(plane.a);
        aInput.className = 'equation-input';
        aInput.addEventListener('input', (e) => {
            plane.a = parseFloat(e.target.value) || 0;
            plane.currentA = plane.a; // Keep current values in sync
            plane.originalA = plane.a; // Keep original values in sync
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row1.appendChild(aInput);
        
        const xLabel = document.createElement('span');
        xLabel.textContent = 'x +';
        xLabel.style.fontSize = '0.85em';
        row1.appendChild(xLabel);
        
        // Coefficient b
        const bInput = document.createElement('input');
        bInput.type = 'number';
        bInput.step = '0.1';
        bInput.value = formatNum(plane.b);
        bInput.className = 'equation-input';
        bInput.addEventListener('input', (e) => {
            plane.b = parseFloat(e.target.value) || 0;
            plane.currentB = plane.b; // Keep current values in sync
            plane.originalB = plane.b; // Keep original values in sync
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
        
        // Coefficient c
        const cInput = document.createElement('input');
        cInput.type = 'number';
        cInput.step = '0.1';
        cInput.value = formatNum(plane.c);
        cInput.className = 'equation-input';
        cInput.addEventListener('input', (e) => {
            plane.c = parseFloat(e.target.value) || 0;
            plane.currentC = plane.c; // Keep current values in sync
            plane.originalC = plane.c; // Keep original values in sync
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row2.appendChild(cInput);
        
        const zLabel = document.createElement('span');
        zLabel.textContent = 'z =';
        zLabel.style.fontSize = '0.85em';
        row2.appendChild(zLabel);
        
        // Constant d
        const dInput = document.createElement('input');
        dInput.type = 'number';
        dInput.step = '0.1';
        dInput.value = formatNum(plane.d);
        dInput.className = 'equation-input';
        dInput.addEventListener('input', (e) => {
            plane.d = parseFloat(e.target.value) || 0;
            plane.currentD = plane.d; // Keep current values in sync
            plane.originalD = plane.d; // Keep original values in sync
            this.renderPlane(plane);
            this.updateIntersections();
        });
        row2.appendChild(dInput);
        
        planeInfo.appendChild(row2);
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

    updateVectorArrow(vec) {
        // Remove old arrow
        this.scene.remove(vec.arrow);
        
        // Create new arrow
        const direction = vec.currentEnd.clone().normalize();
        const length = vec.currentEnd.length();
        
        if (length > 0) {
            const thickness = this.getArrowThickness();
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
    }

    removeVector(id) {
        const index = this.vectors.findIndex(v => v.id === id);
        if (index !== -1) {
            const vec = this.vectors[index];
            // Remove all visualizations
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
            
            this.vectors.splice(index, 1);
            
            // Rebuild path if in path mode
            if (this.vectorDisplayMode === 'path') {
                this.updateVectorDisplay();
            }
            
            this.updateVectorList();
        }
    }

    toggleVectorVisibility(id) {
        const vec = this.vectors.find(v => v.id === id);
        if (vec) {
            vec.visible = !vec.visible;
            
            // Update visualization based on current mode
            this.updateVectorDisplay();
            
            // Update the list to reflect the change
            this.updateObjectsList();
        }
    }
    
    toggleLineVisibility(id) {
        const line = this.lines.find(l => l.id === id);
        if (line) {
            line.visible = !line.visible;
            if (line.mesh) {
                line.mesh.visible = line.visible;
            }
            this.updateObjectsList();
            this.updateIntersections();
        }
    }
    
    togglePlaneVisibility(id) {
        const plane = this.planes.find(p => p.id === id);
        if (plane) {
            plane.visible = !plane.visible;
            if (plane.mesh) {
                plane.mesh.visible = plane.visible;
            }
            this.updateObjectsList();
            this.updateIntersections();
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
            this.updateObjectsList();
            this.updateIntersections();
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
            this.updateObjectsList();
            this.updateIntersections();
        }
    }

    applyMatrix(id) {
        // Apply this matrix transformation to all vectors
        this.animateTransformation(id);
    }

    showMatrixInfo(id) {
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
        }
        
        // Update the eigenvalue panel
        this.updateEigenvaluePanel();
    }


    clearVectors() {
        this.vectors.forEach(vec => {
            if (vec.arrow) this.scene.remove(vec.arrow);
            if (vec.pointSphere) this.scene.remove(vec.pointSphere);
        });
        this.pathLines.forEach(line => this.scene.remove(line));
        this.pathLines = [];
        this.vectors = [];
        
        // Update the dimension-specific storage
        if (this.dimension === '2d') {
            this.vectors2D = this.vectors;
        } else {
            this.vectors3D = this.vectors;
        }
        
        this.updateObjectsList();
    }

    resetVectors() {
        this.vectors.forEach(vec => {
            const original = vec.originalEnd;
            vec.currentEnd.copy(original);
            
            const direction = original.clone().normalize();
            const length = original.length();
            
            this.scene.remove(vec.arrow);
            const thickness = this.getArrowThickness();
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
        
        this.visualizeInvariantSpaces();
        this.updateObjectsList();
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
        
        this.visualizeInvariantSpaces();
        this.updateObjectsList();
    }

    addPresetVectors(preset) {
        // Clear existing vectors first
        this.clearVectors();
        
        // Define preset vector coordinates
        let vectors = [];
        
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
                break;
                
            case 'preset-triangle':
                // Equilateral triangle
                vectors = [
                    [0, 0, 0],
                    [1, 0, 0],
                    [0.5, 0.866, 0]
                ];
                break;
                
            case 'preset-pentagon':
                // Regular pentagon
                for (let i = 0; i < 5; i++) {
                    const angle = (i * 2 * Math.PI / 5) - Math.PI / 2; // Start from top
                    vectors.push([Math.cos(angle), Math.sin(angle), 0]);
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
                break;
                
            case 'preset-circle':
                // Circle approximation with 8 points
                for (let i = 0; i < 8; i++) {
                    const angle = (i * 2 * Math.PI / 8); // Start from right
                    vectors.push([Math.cos(angle), Math.sin(angle), 0]);
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
                break;
        }
        
        // Add all vectors
        vectors.forEach(v => this.addVector(v[0], v[1], v[2]));
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
            }
            
            this.updateObjectsList();
        }
    }

    getMatrixById(id) {
        return this.matrices.find(m => m.id === id);
    }

    animateTransformation(matrixId = null) {
        if (this.isAnimating || (this.vectors.length === 0 && this.lines.length === 0 && this.planes.length === 0)) return;
        
        // Auto-close panel on mobile/narrow screens to see the animation
        if (window.innerWidth < 768 && this.panelOpen) {
            const controlPanel = document.querySelector('.control-panel');
            const panelToggleBtn = document.getElementById('panel-toggle-btn');
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

        this.isAnimating = true;
        const duration = this.animationSpeed * 1000;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = this.easeInOutCubic(progress);

            this.vectors.forEach(vec => {
                const original = vec.originalEnd.clone();
                
                // Use linear interpolation for all transformations
                const identityMatrix = new THREE.Matrix3().identity();
                const interpolatedMatrix = new THREE.Matrix3();
                
                for (let i = 0; i < 9; i++) {
                    interpolatedMatrix.elements[i] = 
                        identityMatrix.elements[i] * (1 - eased) + 
                        matrix.elements[i] * eased;
                }
                
                const current = original.clone().applyMatrix3(interpolatedMatrix);
                
                vec.currentEnd.copy(current);

                // Update arrow
                const direction = current.clone().normalize();
                const length = current.length();
                
                // Remove old arrow from scene first
                if (vec.arrow) {
                    this.scene.remove(vec.arrow);
                }
                
                const thickness = this.getArrowThickness();
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
                
                // Use linear interpolation for transformations
                const identityMatrix = new THREE.Matrix3().identity();
                const interpolatedMatrix = new THREE.Matrix3();
                
                for (let i = 0; i < 9; i++) {
                    interpolatedMatrix.elements[i] = 
                        identityMatrix.elements[i] * (1 - eased) + 
                        matrix.elements[i] * eased;
                }
                
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
                    
                    // Use linear interpolation for transformations
                    const identityMatrix4 = new THREE.Matrix4().identity();
                    const interpolatedMatrix4 = new THREE.Matrix4();
                    
                    for (let i = 0; i < 16; i++) {
                        interpolatedMatrix4.elements[i] = 
                            identityMatrix4.elements[i] * (1 - eased) + 
                            matrix4.elements[i] * eased;
                    }
                    
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
            }
        };

        animate();
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Line and Plane Functions
    addLine(ax = 0, ay = 1, az = 0, bx = 1, by = 0, bz = 0) {
        const colorHex = this.vectorColors[this.colorIndex % this.vectorColors.length];
        this.colorIndex++;
        
        const line = {
            id: this.nextLineId++,
            name: `L${this.lines.length + 1}`,
            point: { x: ax, y: ay, z: az },
            direction: { x: bx, y: by, z: bz },
            originalPoint: { x: ax, y: ay, z: az },
            originalDirection: { x: bx, y: by, z: bz },
            currentPoint: { x: ax, y: ay, z: az },
            currentDirection: { x: bx, y: by, z: bz },
            color: colorHex,
            visible: true,
            mesh: null
        };
        
        this.lines.push(line);
        this.renderLine(line);
        this.updateObjectsList();
        this.updateIntersections();
        return line;
    }

    addPlane(a = 0, b = 0, c = 1, d = 0) {
        if (this.dimension === '2d') return;
        
        const colorHex = this.vectorColors[this.colorIndex % this.vectorColors.length];
        this.colorIndex++;
        
        const plane = {
            id: this.nextPlaneId++,
            name: `P${this.planes.length + 1}`,
            a, b, c, d,
            originalA: a, originalB: b, originalC: c, originalD: d,
            currentA: a, currentB: b, currentC: c, currentD: d,
            color: colorHex,
            visible: true,
            mesh: null
        };
        
        this.planes.push(plane);
        this.renderPlane(plane);
        this.updateObjectsList();
        this.updateIntersections();
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
    }

    renderPlane(plane) {
        if (this.dimension === '2d') return;
        
        // Remove existing mesh if any
        if (plane.mesh) {
            this.scene.remove(plane.mesh);
        }

        const geometry = new THREE.PlaneGeometry(20, 20);
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

    updateVectorThickness() {
        // Recreate all vectors with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation
        
        // Throttle updates - only update if camera distance changed significantly
        const currentDistance = this.camera.position.distanceTo(this.controls.target);
        const distanceChange = Math.abs(currentDistance - this.lastCameraDistance);
        const relativeChange = this.lastCameraDistance > 0 ? distanceChange / this.lastCameraDistance : 1;
        
        // Only update if distance changed by more than 10%
        if (relativeChange < 0.1) return;
        
        this.lastCameraDistance = currentDistance;
        
        this.vectors.forEach(vec => {
            const direction = vec.currentEnd.clone().normalize();
            const length = vec.currentEnd.length();
            
            // Remove old arrow from scene
            if (vec.arrow) {
                this.scene.remove(vec.arrow);
            }
            
            const thickness = this.getArrowThickness();
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
        
        const thickness = this.getArrowThickness();
        const lineRadiusMultiplier = this.dimension === '2d' ? 1.8 : 2.5;
        const lineRadius = thickness.headWidth * 0.15 * lineRadiusMultiplier;
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
                depthWrite: oldMaterial.depthWrite
            };
            
            // Preserve texture if it exists (for solid mode)
            if (oldMaterial.map) {
                materialProps.map = oldMaterial.map;
            } else {
                materialProps.color = oldMaterial.color;
            }
            
            const material = new THREE.MeshBasicMaterial(materialProps);
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the direction
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines render on top of axes when overlapping
            cylinder.renderOrder = 1;
            
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

    createLineEquationLabel(point, direction) {
        // Format line equation: r = (px, py, pz) + t(dx, dy, dz)
        const px = Math.abs(point.x) < 0.01 ? 0 : parseFloat(point.x.toFixed(2));
        const py = Math.abs(point.y) < 0.01 ? 0 : parseFloat(point.y.toFixed(2));
        const pz = Math.abs(point.z) < 0.01 ? 0 : parseFloat(point.z.toFixed(2));
        const dx = Math.abs(direction.x) < 0.01 ? 0 : parseFloat(direction.x.toFixed(2));
        const dy = Math.abs(direction.y) < 0.01 ? 0 : parseFloat(direction.y.toFixed(2));
        const dz = Math.abs(direction.z) < 0.01 ? 0 : parseFloat(direction.z.toFixed(2));
        
        const text = `r = (${px}, ${py}, ${pz}) + t(${dx}, ${dy}, ${dz})`;
        
        // Create canvas for the text
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        
        // Clear background
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw text
        context.fillStyle = '#00FFFF'; // Cyan for plane intersection lines
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
            side: THREE.DoubleSide
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

    updateIntersections() {
        // Clear existing markers
        this.clearIntersections();
        
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
                
                // Position label at midpoint
                label.position.copy(midpoint);
                
                // Orient label so text runs along the line
                // Calculate perpendicular offset direction (towards camera)
                const cameraDir = new THREE.Vector3().subVectors(this.camera.position, midpoint).normalize();
                
                // Ensure direction is normalized
                const normalizedDir = dir.clone().normalize();
                
                // Calculate perpendicular vector (cross with camera direction)
                const perpendicular = new THREE.Vector3().crossVectors(normalizedDir, cameraDir);
                
                // If perpendicular is too small, use a different approach
                if (perpendicular.length() < 0.1) {
                    // Use world up as fallback
                    const worldUp = new THREE.Vector3(0, 1, 0);
                    perpendicular.crossVectors(normalizedDir, worldUp);
                    if (perpendicular.length() < 0.1) {
                        perpendicular.set(1, 0, 0); // Ultimate fallback
                    }
                }
                perpendicular.normalize();
                
                // Calculate outward direction (normal to text plane)
                const outward = new THREE.Vector3().crossVectors(perpendicular, normalizedDir).normalize();
                
                // Offset the label perpendicular to the line (towards camera)
                const labelOffset = this.camera.position.distanceTo(this.controls.target) * 0.15;
                label.position.add(outward.multiplyScalar(labelOffset));
                
                // Orient the label: text should run along the line direction
                // For PlaneGeometry, we need to rotate so the text aligns with the line
                // The text plane's local X-axis should align with the line direction
                const rightVector = normalizedDir.clone();  // Text runs along line
                const upVector = perpendicular.clone();     // Text height direction
                const forwardVector = outward.clone();      // Normal to text plane
                
                // Create rotation matrix with proper basis vectors
                const rotMatrix = new THREE.Matrix4();
                rotMatrix.makeBasis(rightVector, upVector, forwardVector);
                label.quaternion.setFromRotationMatrix(rotMatrix);
                
                // Store line and label
                this.planeIntersectionLines.push({ line: lineMesh, label });
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
        if (!this.axisNumbers) return;
        
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const scale = distanceToTarget * 0.05;
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
        // Update all point sphere scales to maintain consistent screen size
        const distanceToTarget = this.camera.position.distanceTo(this.controls.target);
        const baseScale = distanceToTarget * 0.08; // Larger for better visibility
        
        this.vectors.forEach(vec => {
            if (vec.pointSphere) {
                // Cap sphere radius to be proportional to vector length (10% max)
                const vectorLength = vec.currentEnd.length();
                const maxScale = (vectorLength * 0.1) / 0.15; // 0.15 is the base sphere radius
                const cappedScale = Math.min(baseScale, maxScale);
                
                vec.pointSphere.scale.set(cappedScale, cappedScale, cappedScale);
            }
        });
    }

    updateTheme() {
        // Update scene background color based on current theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.scene.background = new THREE.Color(currentTheme === 'light' ? 0xFDFDFD : 0x606060);
        
        // Regenerate grid and axis numbers with theme-appropriate colors
        this.createGrid();
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
        const eigenvalueMap = new Map(); // Map eigenvalue -> array of vectors
        
        for (const lambda of eigenvalues) {
            const realValue = lambda.real;
            
            // Skip if imaginary part is too large
            if (Math.abs(lambda.imag) > epsilon) {
                continue;
            }
            
            // Check if we already have vectors for this eigenvalue
            let existingVectors = [];
            for (const [key, vectors] of eigenvalueMap) {
                if (Math.abs(realValue - key) < 1e-6) {
                    existingVectors = vectors;
                    break;
                }
            }
            
            // Pass all existing vectors for this eigenvalue to avoid them
            const v = this.computeEigenvector3D(m, realValue, existingVectors);
                
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
                    result.push({ value: realValue, vector: v });
                    
                    // Store this vector
                    if (existingVectors.length === 0) {
                        eigenvalueMap.set(realValue, [v]);
                    } else {
                        existingVectors.push(v);
                    }
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
        
        // Check if all rows are proportional (degenerate case - 2D eigenspace)
        const isDegenerate = (mag1 > epsilon && mag2 > epsilon && mag3 > epsilon && 
             Math.abs(row1.clone().normalize().dot(row2.clone().normalize())) > 0.99);
        
        if (isDegenerate) {
            // All rows are the same or proportional - 2D eigenspace (plane)
            // All rows are the same or zero - 2D or 3D eigenspace
            // Find any vector perpendicular to the row
            let normalRow = row1;
            if (mag1 < epsilon) normalRow = row2;
            if (mag1 < epsilon && mag2 < epsilon) normalRow = row3;
            
            if (normalRow.lengthSq() > epsilon) {
                normalRow.normalize();
                
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
        // In this case, don't show any specific invariant lines/planes
        if (this.isIdentityLike(matrix)) {
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
        
        // Get same thickness as axes, but make invariant lines slightly thicker for visibility
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.15 * 1.8; // 1.8x thicker than axes
        
        eigendata.forEach((eigen, index) => {
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
                    depthTest: false
                });
            } else {
                // Use bright magenta for pulse mode with higher opacity
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: false
                });
            }
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the eigenvector direction
            // CylinderGeometry is aligned along Y axis by default
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines render on top of axes when overlapping
            cylinder.renderOrder = 1;
            
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
        
        // Get same thickness as axes, but make invariant lines thicker for visibility
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.15 * 2.5; // 2.5x thicker than axes
        
        eigendata.forEach((eigen, index) => {
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
                    depthWrite: false
                });
            } else {
                // Use bright magenta for pulse mode with higher opacity
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.95,
                    depthTest: true,
                    depthWrite: false
                });
            }
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the eigenvector direction
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            // Ensure invariant lines render on top of axes when overlapping
            cylinder.renderOrder = 1;
            
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
            let found = false;
            for (const [key, group] of eigenvalueGroups) {
                if (Math.abs(eigen.value - key) < epsilon) {
                    group.push(eigen.vector);
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
        const matrixName = selectedMatrix ? selectedMatrix.name : '';
        
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
            return val.toFixed(3);
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
            invariantHeader.innerHTML = '<span>Show invariant spaces</span>';
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

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.updateAxesLength();
        this.updateGridSpacing();
        this.updateNumberLabelScales();
        this.updatePointSphereScales();
        this.updateVectorThickness();
        this.updateInvariantSpaceColors();
        this.renderer.render(this.scene, this.camera);
    }
}

// App will be initialized when Start button is clicked (see title screen code above)