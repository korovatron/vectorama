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
        
        this.panelOpen = true; // Panel open by default
        this.initThreeJS();
        this.initEventListeners();
        this.createGrid();
        this.createAxes();
        this.animate();
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
                // Could add live preview here
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

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.updateAxesLength();
        this.updateGridSpacing();
        this.updateNumberLabelScales();
        this.renderer.render(this.scene, this.camera);
    }
}

// App will be initialized when Start button is clicked (see title screen code above)