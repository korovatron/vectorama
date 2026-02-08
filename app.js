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
    lightIcon.style.opacity = '1';
    darkIcon.style.opacity = '0';
}

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    
    // Animate icon transition
    if (newTheme === 'light') {
        lightIcon.style.opacity = '1';
        darkIcon.style.opacity = '0';
    } else {
        lightIcon.style.opacity = '0';
        darkIcon.style.opacity = '1';
    }
    
    // Update scene background if app exists
    if (window.vectoramaApp) {
        window.vectoramaApp.updateTheme();
    }
});

class VectoramaApp {
    constructor() {
        this.appMode = 'transform'; // 'transform' or 'geometry'
        this.dimension = '2d'; // '2d' or '3d'
        this.vectors = [];
        this.geometryObjects = []; // For geometry mode: lines, planes, etc.
        this.isAnimating = false;
        this.animationSpeed = 2.0;
        this.isDragging = false;
        this.axisLengthX = 100; // Dynamic X axis length
        this.axisLengthY = 100; // Dynamic Y axis length
        this.axisLengthZ = 100; // Dynamic Z axis length
        this.lastCameraDistance = 0; // Track camera distance for vector thickness updates
        this.tempArrow = null;
        this.geometryType = 'vector'; // 'vector', 'line', 'plane'
        this.gridVisible = true; // Grid visibility state
        this.currentGridSpacing = 1; // Current grid spacing
        this.isResizing = false; // Flag to prevent animation loop interference
        this.resizeTimeout = null; // For debouncing
        this.updateTimeout = null; // For debouncing grid/axes updates during zoom
        this.lastUpdateTime = 0; // Track last update time for throttling
        
        this.invariantLines = []; // Store invariant line objects (eigenvectors)
        this.invariantPlanes = []; // Store invariant plane objects (eigenspaces)
        this.rainbowTime = 0; // Time variable for rainbow pulsing effect
        this.invariantDisplayMode = 'pulse'; // 'off', 'solid', 'pulse'
        
        this.panelOpen = true; // Panel open by default
        this.initThreeJS();
        this.initEventListeners();
        this.createGrid();
        this.createAxes();
        this.animate();
        
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
        this.camera.position.set(0, 0, 10); // Start looking at XY plane for 2D mode
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
            for (let i = -range; i <= range; i++) {
                if (i === 0) continue; // Skip origin
                const value = i * spacing;
                
                // X axis numbers (below the axis) - gray to match axes
                const xLabel = this.createNumberLabel(value, '#888888');
                xLabel.position.set(value, -labelOffset, 0);
                xLabel.userData = { axis: 'x', value: value };
                this.axisNumbers.add(xLabel);
                
                // Y axis numbers (left of the axis) - gray to match axes
                const yLabel = this.createNumberLabel(value, '#888888');
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
            for (let i = -range; i <= range; i++) {
                if (i === 0) continue; // Skip origin
                const value = i * spacing;
                
                // X axis numbers (along x axis, on XZ plane) - gray to match axes
                const xLabel = this.createNumberLabel(value, '#888888');
                xLabel.position.set(value, 0, -labelOffset);
                xLabel.userData = { axis: 'x', value: value };
                this.axisNumbers.add(xLabel);
                
                // Y axis numbers (along y axis, on YZ plane) - gray to match axes
                const yLabel = this.createNumberLabel(value, '#888888');
                yLabel.position.set(-labelOffset, value, 0);
                yLabel.userData = { axis: 'y', value: value };
                this.axisNumbers.add(yLabel);
                
                // Z axis numbers (along z axis, on XZ plane) - gray to match axes
                const zLabel = this.createNumberLabel(value, '#888888');
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
        
        const shaftLength = length - headLength;
        const shaftRadius = headWidth * 0.3;
        
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
            depthTest: true
        });
        const shaft = new THREE.Mesh(shaftGeometry, material);
        shaft.position.copy(direction.clone().multiplyScalar(shaftLength / 2));
        
        // Orient shaft along direction
        const axis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());
        shaft.quaternion.copy(quaternion);
        
        // Head - cone with segments based on mode (triangle in 2D, circle in 3D)
        const headGeometry = new THREE.ConeGeometry(
            headWidth, 
            headLength, 
            radialSegments,
            1,
            false
        );
        const head = new THREE.Mesh(headGeometry, material);
        head.position.copy(direction.clone().multiplyScalar(shaftLength + headLength / 2));
        head.quaternion.copy(quaternion);
        
        group.add(shaft, head);
        group.position.copy(origin);
        
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

    initEventListeners() {
        // Panel toggle button
        const panelToggleBtn = document.getElementById('panel-toggle-btn');
        const controlPanel = document.querySelector('.control-panel');
        
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
        
        // App mode switching
        document.getElementById('app-mode-transform').addEventListener('click', () => this.switchAppMode('transform'));
        document.getElementById('app-mode-geometry').addEventListener('click', () => this.switchAppMode('geometry'));
        
        // Reset view button
        document.getElementById('reset-view-btn').addEventListener('click', () => this.resetView());
        
        // Toggle grid button
        document.getElementById('toggle-grid-btn').addEventListener('click', () => this.toggleGrid());
        
        // Toggle invariant display button
        document.getElementById('toggle-invariant-btn').addEventListener('click', () => this.toggleInvariant());

        // Transform mode - dimension switching
        document.getElementById('mode-2d').addEventListener('click', () => this.switchDimension('2d'));
        document.getElementById('mode-3d').addEventListener('click', () => this.switchDimension('3d'));

        // Geometry mode - dimension switching
        document.getElementById('geom-mode-2d').addEventListener('click', () => this.switchDimension('2d'));
        document.getElementById('geom-mode-3d').addEventListener('click', () => this.switchDimension('3d'));

        // Geometry type switching
        document.querySelectorAll('.geometry-type-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchGeometryType(btn.dataset.type));
        });

        // Transform mode - Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset));
        });

        // Transform mode - Animation controls
        document.getElementById('animate-btn').addEventListener('click', () => this.animateTransformation());
        document.getElementById('reset-btn').addEventListener('click', () => this.resetVectors());

        // Speed slider
        const speedSlider = document.getElementById('speed-slider');
        const speedValue = document.getElementById('speed-value');
        speedSlider.addEventListener('input', (e) => {
            this.animationSpeed = parseFloat(e.target.value);
            speedValue.textContent = `${this.animationSpeed.toFixed(1)}s`;
        });

        // Geometry mode - Add buttons
        document.getElementById('add-vector-btn').addEventListener('click', () => this.addGeometryVector());
        document.getElementById('add-line-btn').addEventListener('click', () => this.addGeometryLine());
        document.getElementById('add-plane-btn').addEventListener('click', () => this.addGeometryPlane());

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

    switchAppMode(mode) {
        this.appMode = mode;

        // Update UI
        document.querySelectorAll('.app-mode-btn').forEach(btn => btn.classList.remove('active'));
        
        if (mode === 'transform') {
            document.getElementById('app-mode-transform').classList.add('active');
            document.getElementById('transform-mode-content').style.display = 'block';
            document.getElementById('geometry-mode-content').style.display = 'none';
        } else {
            document.getElementById('app-mode-geometry').classList.add('active');
            document.getElementById('transform-mode-content').style.display = 'none';
            document.getElementById('geometry-mode-content').style.display = 'block';
        }

        // Clear and reset
        this.clearVectors();
        this.clearGeometryObjects();
        this.clearInvariantSpaces();
    }

    switchGeometryType(type) {
        this.geometryType = type;

        // Update UI
        document.querySelectorAll('.geometry-type-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.type === type) {
                btn.classList.add('active');
            }
        });

        // Show/hide appropriate input sections
        document.getElementById('geom-vector-input').style.display = type === 'vector' ? 'block' : 'none';
        document.getElementById('geom-line-input').style.display = type === 'line' ? 'block' : 'none';
        document.getElementById('geom-plane-input').style.display = type === 'plane' ? 'block' : 'none';

        // Hide/show z coordinate for planes (only in 3D)
        if (type === 'plane' && this.dimension === '2d') {
            // In 2D, plane input doesn't make sense, switch to line
            this.switchGeometryType('line');
        }
    }

    switchDimension(dimension) {
        this.dimension = dimension;
        this.isResizing = true; // Prevent animation loop from interfering

        // Update appropriate mode buttons based on current app mode
        if (this.appMode === 'transform') {
            document.querySelectorAll('#transform-mode-content .mode-btn').forEach(btn => btn.classList.remove('active'));
            if (dimension === '2d') {
                document.getElementById('mode-2d').classList.add('active');
                document.getElementById('matrix-2d').style.display = 'block';
                document.getElementById('matrix-3d').style.display = 'none';
            } else {
                document.getElementById('mode-3d').classList.add('active');
                document.getElementById('matrix-2d').style.display = 'none';
                document.getElementById('matrix-3d').style.display = 'block';
            }
        } else {
            // Geometry mode
            document.querySelectorAll('#geometry-mode-content .mode-btn').forEach(btn => btn.classList.remove('active'));
            if (dimension === '2d') {
                document.getElementById('geom-mode-2d').classList.add('active');
                // Hide z-coordinate inputs in 2D
                document.getElementById('vec-z-container').style.display = 'none';
                document.getElementById('line-az-container').style.display = 'none';
                document.getElementById('line-bz-container').style.display = 'none';
                // Hide plane option in 2D (planes are 3D only)
                document.querySelector('[data-type="plane"]').style.display = 'none';
                if (this.geometryType === 'plane') {
                    this.switchGeometryType('line');
                }
            } else {
                document.getElementById('geom-mode-3d').classList.add('active');
                // Show z-coordinate inputs in 3D
                document.getElementById('vec-z-container').style.display = 'inline';
                document.getElementById('line-az-container').style.display = 'inline';
                document.getElementById('line-bz-container').style.display = 'inline';
                // Show plane option in 3D
                document.querySelector('[data-type="plane"]').style.display = 'inline-block';
            }
        }

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
            
            // Update instructions
            document.getElementById('control-instructions').textContent = '🖱️ Right click: Create vectors | Left click: Pan | Scroll: Zoom';
        } else {
            // Enable full 3D camera control
            this.camera.position.set(5, 5, 5);
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
            
            // Update instructions
            document.getElementById('control-instructions').textContent = '🖱️ Middle click: Create vectors | Left click: Rotate | Right click: Pan | Scroll: Zoom';
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
        
        this.clearVectors();
        this.clearInvariantSpaces();
    }

    resetView() {
        // Reset camera to default position for current dimension
        if (this.dimension === '2d') {
            this.camera.position.set(0, 0, 10);
            this.camera.lookAt(0, 0, 0);
        } else {
            this.camera.position.set(5, 5, 5);
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
        
        // Update button text
        const btn = document.getElementById('toggle-grid-btn');
        btn.textContent = this.gridVisible ? 'Hide Grid' : 'Show Grid';
    }
    
    toggleInvariant() {
        // Cycle through: pulse -> solid -> off -> pulse
        if (this.invariantDisplayMode === 'pulse') {
            this.invariantDisplayMode = 'solid';
        } else if (this.invariantDisplayMode === 'solid') {
            this.invariantDisplayMode = 'off';
        } else {
            this.invariantDisplayMode = 'pulse';
        }
        
        // Update button text
        const btn = document.getElementById('toggle-invariant-btn');
        const labels = {
            'pulse': 'Invariant: Pulse',
            'solid': 'Invariant: Solid',
            'off': 'Invariant: Off'
        };
        btn.textContent = labels[this.invariantDisplayMode];
        
        // Re-visualize to apply the new mode
        this.visualizeInvariantSpaces();
    }

    applyPreset(preset) {
        const dimension = this.dimension;
        
        if (dimension === '2d') {
            const inputs = {
                '00': document.getElementById('m2-00'),
                '01': document.getElementById('m2-01'),
                '10': document.getElementById('m2-10'),
                '11': document.getElementById('m2-11')
            };

            switch(preset) {
                case 'identity':
                    inputs['00'].value = 1; inputs['01'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 1;
                    break;
                case 'rotation':
                    const cos45 = Math.cos(Math.PI / 4);
                    const sin45 = Math.sin(Math.PI / 4);
                    inputs['00'].value = cos45; inputs['01'].value = -sin45;
                    inputs['10'].value = sin45; inputs['11'].value = cos45;
                    break;
                case 'scale':
                    inputs['00'].value = 2; inputs['01'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 2;
                    break;
                case 'shear':
                    inputs['00'].value = 1; inputs['01'].value = 0.5;
                    inputs['10'].value = 0; inputs['11'].value = 1;
                    break;
                case 'reflection':
                    inputs['00'].value = -1; inputs['01'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 1;
                    break;
            }
        } else {
            const inputs = {
                '00': document.getElementById('m3-00'),
                '01': document.getElementById('m3-01'),
                '02': document.getElementById('m3-02'),
                '10': document.getElementById('m3-10'),
                '11': document.getElementById('m3-11'),
                '12': document.getElementById('m3-12'),
                '20': document.getElementById('m3-20'),
                '21': document.getElementById('m3-21'),
                '22': document.getElementById('m3-22')
            };

            switch(preset) {
                case 'identity':
                    inputs['00'].value = 1; inputs['01'].value = 0; inputs['02'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 1; inputs['12'].value = 0;
                    inputs['20'].value = 0; inputs['21'].value = 0; inputs['22'].value = 1;
                    break;
                case 'rotation':
                    const cos45 = Math.cos(Math.PI / 4);
                    const sin45 = Math.sin(Math.PI / 4);
                    inputs['00'].value = cos45; inputs['01'].value = -sin45; inputs['02'].value = 0;
                    inputs['10'].value = sin45; inputs['11'].value = cos45; inputs['12'].value = 0;
                    inputs['20'].value = 0; inputs['21'].value = 0; inputs['22'].value = 1;
                    break;
                case 'scale':
                    inputs['00'].value = 2; inputs['01'].value = 0; inputs['02'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 2; inputs['12'].value = 0;
                    inputs['20'].value = 0; inputs['21'].value = 0; inputs['22'].value = 2;
                    break;
                case 'shear':
                    inputs['00'].value = 1; inputs['01'].value = 0.5; inputs['02'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 1; inputs['12'].value = 0;
                    inputs['20'].value = 0; inputs['21'].value = 0; inputs['22'].value = 1;
                    break;
                case 'reflection':
                    inputs['00'].value = -1; inputs['01'].value = 0; inputs['02'].value = 0;
                    inputs['10'].value = 0; inputs['11'].value = 1; inputs['12'].value = 0;
                    inputs['20'].value = 0; inputs['21'].value = 0; inputs['22'].value = 1;
                    break;
            }
        }
        
        // Update invariant space visualization after applying preset
        this.visualizeInvariantSpaces();
    }

    getTransformationMatrix() {
        if (this.dimension === '2d') {
            return new THREE.Matrix3().set(
                parseFloat(document.getElementById('m2-00').value), parseFloat(document.getElementById('m2-01').value), 0,
                parseFloat(document.getElementById('m2-10').value), parseFloat(document.getElementById('m2-11').value), 0,
                0, 0, 1
            );
        } else {
            return new THREE.Matrix3().set(
                parseFloat(document.getElementById('m3-00').value), parseFloat(document.getElementById('m3-01').value), parseFloat(document.getElementById('m3-02').value),
                parseFloat(document.getElementById('m3-10').value), parseFloat(document.getElementById('m3-11').value), parseFloat(document.getElementById('m3-12').value),
                parseFloat(document.getElementById('m3-20').value), parseFloat(document.getElementById('m3-21').value), parseFloat(document.getElementById('m3-22').value)
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
        
        const color = new THREE.Color().setHSL(Math.random(), 0.85, 0.35);
        
        const thickness = this.getArrowThickness();
        const arrow = this.createSmoothArrow(
            direction,
            origin,
            length,
            color,
            thickness.headLength,
            thickness.headWidth
        );

        const vector = {
            arrow: arrow,
            originalEnd: new THREE.Vector3(x, y, z),
            currentEnd: new THREE.Vector3(x, y, z),
            color: color,
            id: Date.now()
        };

        this.vectors.push(vector);
        this.scene.add(arrow);
        this.updateVectorList();
    }

    updateVectorList() {
        const listEl = document.getElementById('vector-list');
        listEl.innerHTML = '';

        this.vectors.forEach(vec => {
            const item = document.createElement('div');
            item.className = 'vector-item';
            
            const text = document.createElement('span');
            const end = vec.currentEnd;
            text.textContent = `v = (${end.x.toFixed(2)}, ${end.y.toFixed(2)}${this.dimension === '3d' ? `, ${end.z.toFixed(2)}` : ''})`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.addEventListener('click', () => this.removeVector(vec.id));
            
            item.appendChild(text);
            item.appendChild(deleteBtn);
            listEl.appendChild(item);
        });
    }

    removeVector(id) {
        const index = this.vectors.findIndex(v => v.id === id);
        if (index !== -1) {
            this.scene.remove(this.vectors[index].arrow);
            this.vectors.splice(index, 1);
            this.updateVectorList();
        }
    }

    clearVectors() {
        this.vectors.forEach(vec => this.scene.remove(vec.arrow));
        this.vectors = [];
        this.updateVectorList();
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
            this.scene.add(vec.arrow);
        });
        this.updateVectorList();
    }

    animateTransformation() {
        if (this.isAnimating || this.vectors.length === 0) return;

        this.isAnimating = true;
        const matrix = this.getTransformationMatrix();
        const duration = this.animationSpeed * 1000;
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = this.easeInOutCubic(progress);

            this.vectors.forEach(vec => {
                const original = vec.originalEnd.clone();
                const transformed = original.clone().applyMatrix3(matrix);
                
                // Interpolate between original and transformed
                const current = original.clone().lerp(transformed, eased);
                vec.currentEnd.copy(current);

                // Update arrow
                const direction = current.clone().normalize();
                const length = current.length();
                
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
                this.scene.add(vec.arrow);
            });

            this.updateVectorList();

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.isAnimating = false;
                
                // Update original positions to transformed positions
                this.vectors.forEach(vec => {
                    vec.originalEnd.copy(vec.currentEnd);
                });
            }
        };

        animate();
    }

    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Geometry Mode Functions
    clearGeometryObjects() {
        this.geometryObjects.forEach(obj => {
            this.scene.remove(obj.mesh);
        });
        this.geometryObjects = [];
        document.getElementById('geometry-list').innerHTML = '';
    }

    addGeometryVector() {
        const x = parseFloat(document.getElementById('vec-x').value);
        const y = parseFloat(document.getElementById('vec-y').value);
        const z = this.dimension === '3d' ? parseFloat(document.getElementById('vec-z').value) : 0;

        if (x === 0 && y === 0 && z === 0) return; // Don't add zero vector

        this.addVector(x, y, z);
    }

    addGeometryLine() {
        const ax = parseFloat(document.getElementById('line-ax').value);
        const ay = parseFloat(document.getElementById('line-ay').value);
        const az = this.dimension === '3d' ? parseFloat(document.getElementById('line-az').value) : 0;

        const bx = parseFloat(document.getElementById('line-bx').value);
        const by = parseFloat(document.getElementById('line-by').value);
        const bz = this.dimension === '3d' ? parseFloat(document.getElementById('line-bz').value) : 0;

        // Create line geometry
        const points = [];
        const tMin = -10;
        const tMax = 10;
        const steps = 100;

        for (let i = 0; i <= steps; i++) {
            const t = tMin + (tMax - tMin) * (i / steps);
            points.push(new THREE.Vector3(
                ax + t * bx,
                ay + t * by,
                az + t * bz
            ));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const color = new THREE.Color().setHSL(Math.random(), 0.85, 0.45);
        const material = new THREE.LineBasicMaterial({ color: color });
        const line = new THREE.Line(geometry, material);

        this.scene.add(line);

        const lineObj = {
            type: 'line',
            mesh: line,
            equation: `r = (${ax}, ${ay}${this.dimension === '3d' ? `, ${az}` : ''}) + t(${bx}, ${by}${this.dimension === '3d' ? `, ${bz}` : ''})`,
            id: Date.now()
        };

        this.geometryObjects.push(lineObj);
        this.updateGeometryList();
    }

    addGeometryPlane() {
        if (this.dimension === '2d') return; // Planes only in 3D

        const a = parseFloat(document.getElementById('plane-a').value);
        const b = parseFloat(document.getElementById('plane-b').value);
        const c = parseFloat(document.getElementById('plane-c').value);
        const d = parseFloat(document.getElementById('plane-d').value);

        if (a === 0 && b === 0 && c === 0) return; // Invalid plane

        // Create plane mesh with random color
        const geometry = new THREE.PlaneGeometry(20, 20);
        const color = new THREE.Color().setHSL(Math.random(), 0.7, 0.5);
        const material = new THREE.MeshBasicMaterial({ 
            color: color, 
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false // Prevent z-fighting with grid lines
        });
        const plane = new THREE.Mesh(geometry, material);

        // Position and orient plane based on equation ax + by + cz = d
        const normal = new THREE.Vector3(a, b, c).normalize();
        const distance = d / Math.sqrt(a * a + b * b + c * c);
        
        plane.position.copy(normal.clone().multiplyScalar(distance));
        plane.lookAt(plane.position.clone().add(normal));

        this.scene.add(plane);

        const planeObj = {
            type: 'plane',
            mesh: plane,
            equation: `${a}x + ${b}y + ${c}z = ${d}`,
            id: Date.now()
        };

        this.geometryObjects.push(planeObj);
        this.updateGeometryList();
    }

    updateGeometryList() {
        const listEl = document.getElementById('geometry-list');
        listEl.innerHTML = '';

        this.geometryObjects.forEach(obj => {
            const item = document.createElement('div');
            item.className = 'vector-item';
            
            const text = document.createElement('span');
            text.textContent = `${obj.type}: ${obj.equation}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-btn';
            deleteBtn.textContent = '×';
            deleteBtn.addEventListener('click', () => this.removeGeometryObject(obj.id));
            
            item.appendChild(text);
            item.appendChild(deleteBtn);
            listEl.appendChild(item);
        });
    }

    removeGeometryObject(id) {
        const index = this.geometryObjects.findIndex(obj => obj.id === id);
        if (index !== -1) {
            this.scene.remove(this.geometryObjects[index].mesh);
            this.geometryObjects.splice(index, 1);
            this.updateGeometryList();
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
            this.lastCameraDistance = distanceToTarget;
        }
    }

    updateVectorThickness() {
        // Recreate all vectors with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation
        
        this.vectors.forEach(vec => {
            const direction = vec.currentEnd.clone().normalize();
            const length = vec.currentEnd.length();
            
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
            this.scene.add(vec.arrow);
        });
    }

    updateInvariantLineThickness() {
        // Recreate all invariant lines with updated thickness based on current camera distance
        if (this.isAnimating) return; // Don't update during animation
        
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.15;
        const lineLength = 200;
        
        this.invariantLines.forEach(lineObj => {
            const direction = lineObj.direction;
            
            // Remove old mesh
            this.scene.remove(lineObj.mesh);
            
            // Create new cylinder with updated thickness
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            const material = new THREE.MeshBasicMaterial({
                color: lineObj.mesh.material.color,
                transparent: true,
                opacity: lineObj.mesh.material.opacity,
                depthTest: false
            });
            
            const cylinder = new THREE.Mesh(geometry, material);
            
            // Position and orient the cylinder along the direction
            const quaternion = new THREE.Quaternion();
            const yAxis = new THREE.Vector3(0, 1, 0);
            quaternion.setFromUnitVectors(yAxis, direction);
            cylinder.quaternion.copy(quaternion);
            
            this.scene.add(cylinder);
            
            // Update the reference
            lineObj.mesh = cylinder;
        });
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

    updateTheme() {
        // Update scene background color based on current theme
        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.scene.background = new THREE.Color(currentTheme === 'light' ? 0xFDFDFD : 0x606060);
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
            // Complex eigenvalues - no real invariant lines
            return [];
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
                const theta = Math.acos(-q / (2 * sqrtNegP3 * sqrtNegP3 * sqrtNegP3)) / 3;
                
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

    visualizeInvariantSpaces() {
        // Clear existing invariant spaces
        this.clearInvariantSpaces();
        
        // Only show invariant spaces in transform mode and when not off
        if (this.appMode !== 'transform' || this.invariantDisplayMode === 'off') return;
        
        const matrix = this.getTransformationMatrix();
        
        // Check if matrix is a scalar multiple of identity (entire space is invariant)
        // In this case, don't show any specific invariant lines/planes
        if (this.isIdentityLike(matrix)) return;
        
        if (this.dimension === '2d') {
            this.visualizeInvariantSpaces2D(matrix);
        } else {
            this.visualizeInvariantSpaces3D(matrix);
        }
    }
    
    isIdentityLike(matrix) {
        const epsilon = 1e-6;
        const elements = matrix.elements;
        
        if (this.dimension === '2d') {
            // For 2x2: [[a, c], [b, d]] stored as [a, b, c, d]
            const a = elements[0];
            const b = elements[1];
            const c = elements[2];
            const d = elements[3];
            
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
        
        // Get same thickness as axes
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.15;
        
        eigendata.forEach((eigen, index) => {
            const direction = new THREE.Vector3(eigen.vector.x, eigen.vector.y, 0).normalize();
            
            // Create line using cylinder geometry matching axis thickness
            const lineLength = 200; // Very long line
            
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            
            let material;
            if (this.invariantDisplayMode === 'solid') {
                // Use dashed texture for solid mode
                const texture = this.createDashedTexture();
                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: false
                });
            } else {
                // Use plain color for pulse mode
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.9,
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
        
        // Get same thickness as axes
        const thickness = this.getArrowThickness();
        const lineRadius = thickness.headWidth * 0.15;
        
        eigendata.forEach((eigen, index) => {
            const direction = eigen.vector.clone().normalize();
            
            // Create line using cylinder geometry matching axis thickness
            const lineLength = 200; // Very long line
            
            const geometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 8);
            
            let material;
            if (this.invariantDisplayMode === 'solid') {
                // Use dashed texture for solid mode
                const texture = this.createDashedTexture();
                material = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: true,
                    depthWrite: false
                });
            } else {
                // Use plain color for pulse mode
                material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.9,
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

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.updateAxesLength();
        this.updateGridSpacing();
        this.updateNumberLabelScales();
        this.updateInvariantSpaceColors();
        this.renderer.render(this.scene, this.camera);
    }
}

// App will be initialized when Start button is clicked (see title screen code above)