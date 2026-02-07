# Vectorama - Interactive Vector Mathematics

A comprehensive web application for teaching and visualizing vectors, matrix transformations, lines, planes, and linear algebra concepts in both 2D and 3D.

## Features

### Transform Mode
- **2D & 3D Matrix Transformations**: Switch between 2×2 and 3×3 matrix transformations
- **Interactive 3D Scene**: Rotatable, zoomable, and pannable 3D visualization using Three.js
- **Custom Matrix Input**: Enter any transformation matrix manually
- **Preset Transformations**: Quick access to common transformations:
  - Identity
  - Rotation (45°)
  - Scaling
  - Shear
  - Reflection
- **Vector Manipulation**: Drag on the canvas to create vectors
- **Smooth Animations**: Animated transitions between original and transformed states
- **Adjustable Speed**: Control animation speed with a slider
- **Future**: Eigenvalue and eigenvector visualization

### Geometry Mode
- **Vector Plotting**: Add vectors by coordinates or dragging
- **Parametric Lines**: Plot lines using parametric equations (r = a + tb)
- **3D Planes**: Visualize planes using Cartesian equations (ax + by + cz = d)
- **2D & 3D Views**: Switch between dimensions for appropriate visualization
- **Interactive Objects**: Manage multiple geometry objects with delete controls

## Getting Started

1. Open `index.html` in a modern web browser (Chrome, Firefox, Edge, Safari)
2. The app loads with Three.js from CDN - no build step required!

## Usage

### Switching Modes
- Use the **Transform** / **Geometry** buttons at the top to switch between modes
- Each mode has its own 2D/3D dimension controls

### Transform Mode

#### Adding Vectors
- Drag on the canvas to create vectors
- In 2D: Simple drag
- In 3D: Hold Shift + drag (to avoid conflict with camera rotation)
- Vectors snap to grid points when released

#### Transforming Vectors
1. Enter a transformation matrix or select a preset
2. Click "Animate Transformation" to see the smooth transition
3. Click "Reset" to return vectors to their original positions

### Geometry Mode

#### Adding Objects
1. Select object type: Vector, Line, or Plane
2. Enter coordinates or equation parameters
3. Click the "Add" button
4. Objects appear in the list below with delete controls

#### Camera Controls
- **2D Mode**: 
  - Right Click + Drag: Pan the view
  - Scroll: Zoom in/out
- **3D Mode**:
  - Left Click + Drag: Rotate the view
  - Right Click + Drag: Pan the view  
  - Scroll: Zoom in/out

## Technical Stack

- **Three.js**: 3D rendering and WebGL management
- **OrbitControls**: Smooth camera interaction
- **Vanilla JavaScript**: No framework dependencies
- **Modern ES6 Modules**: Clean, modular code structure

## Future Enhancements

- Eigenvalue and eigenvector visualization in Transform mode
- Intersection calculations (line-plane, plane-plane)
- Distance and angle measurements
- Multiple transformation composition
- Export/import configurations
- Step-by-step transformation breakdown
- Teaching mode with explanations

## Browser Compatibility

Requires a modern browser with:
- ES6 module support
- WebGL support
- Import maps support

## License

MIT
