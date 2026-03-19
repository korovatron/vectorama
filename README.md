# Vectorama - Interactive Vector Mathematics

A comprehensive web application for teaching and visualizing vectors, matrix transformations, lines, planes, and linear algebra concepts in both 2D and 3D.

## Changelog

### 1.0.45 (2026-03-16)
- Corrected matrix-info eigenvector display for irrational 2D eigendirections by avoiding fallback integer rounding that could show misleading vectors.

### 1.0.42 (2026-03-16)
- 2D matrix info now appears for the zero matrix by reporting representative eigenvectors for the identity-like λ=0 case.

### 1.0.40 (2026-03-16)
- Fixed a 3D repeated-eigenvalue regression that could incorrectly show a 2D eigenspace plane.
- Added stricter fallback eigenvector validation and a nullity cap guard for repeated eigenvalues.
- Bumped app/service-worker versions so updated eigensolver logic is reliably served.

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

### Solutions Buttons Password
- Current unlock password for `worksheets.html`: **DrinkSlurm**

### Switching Modes
- Use the **Transform** / **Geometry** buttons at the top to switch between modes
- Each mode has its own 2D/3D dimension controls

### Transform Mode

#### Adding Vectors
- Right-click + drag on the canvas to create vectors in both 2D and 3D
- In 3D, while right-dragging, use the mouse wheel or Arrow Up/Down keys to raise/lower the vector's y coordinate in grid steps
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
  - Left or Middle Click + Drag: Pan the view
  - Scroll: Zoom in/out
- **3D Mode**:
  - Left Click + Drag: Rotate the view
  - Middle Click + Drag: Pan the view  
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

PolyForm Noncommercial License 1.0.0

See [LICENSE](LICENSE) for full terms.

Commercial use is not permitted without separate permission.
