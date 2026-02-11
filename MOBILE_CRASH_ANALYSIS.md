# iPhone 15 Pro Max Crash Analysis

## Issue Description
When using iPhone 15 Pro Max specifically, entering 3D mode and zooming in as far as possible, then attempting to rotate the axes causes the app to crash/restart. This is reproducible every time on iPhone 15 Pro Max but does NOT occur on iPad Pro.

**Tested Devices:**
- iPhone 15 Pro Max: ❌ Crashes consistently
- iPad Pro: ✅ Works fine

## Root Cause Analysis

### 1. Pixel Ratio Overload at Extreme Zoom (PRIMARY SUSPECT)

**Location:** `app.js` line 221
```javascript
this.renderer.setPixelRatio(window.devicePixelRatio);
```

**The Problem:**
- iPhone 15 Pro Max has a 3x pixel ratio
- When rendering at 3x, the GPU processes **9x the pixels** (3×3) compared to standard displays
- Additional overhead from:
  - `antialias: true` (line 217)
  - `logarithmicDepthBuffer: true` (line 218) - computationally expensive
- At maximum zoom (minDistance = 1) while rotating, the GPU is overwhelmed

### 2. Cumulative Update Function Overhead

**Location:** `app.js` lines 5433-5443 (animate loop)

The animation loop calls 6 update functions every single frame:
1. `updateAxesLength()` - can recreate axes geometry
2. `updateGridSpacing()` - can recreate entire grid
3. `updateNumberLabelScales()` - updates all label sprites
4. `updatePointSphereScales()` - updates all sphere scales
5. `updateVectorThickness()` - can recreate ALL vector arrows
6. `updateInvariantSpaceColors()` - color/opacity updates

**The Problem:**
- While throttled (150ms checks), non-recreating updates still perform heavy calculations
- At max zoom during rotation, matrix updates and scaling calculations on every frame
- On mobile GPU at 3x pixel ratio, this compounds quickly

### 3. Memory Pressure from Geometry Recreation

**Location:** `app.js` lines 3558-3559 (throttling)

**The Problem:**
- Even with throttling, rapid rotation at max zoom can trigger occasional geometry recreation
- Each recreation allocates new WebGL buffers
- iPhone's memory management is more aggressive than iPad Pro
- Rapid allocation/deallocation during rotation → memory warnings → WebGL context killed

### 4. OrbitControls Damping Interaction

**Location:** `app.js` lines 225-226
```javascript
this.controls.enableDamping = true;
this.controls.dampingFactor = 0.15;
```

**The Problem:**
- Damping causes continuous camera position updates even after touch input ends
- At max zoom with rapid rotation, creates constant camera recalculations
- Compounds all other issues

## Why iPad Pro Survives

1. **More powerful GPU** - Desktop-class GPU cores in iPad Pro
2. **More memory headroom** - Better thermal management allows sustained performance
3. **Larger form factor** - Better heat dissipation prevents throttling
4. **iOS optimization** - Different performance profiles for iPads vs iPhones

## The Crash Mechanism

**WebGL Context Loss** triggered by:
1. **GPU timeout** - Too much rendering work per frame (9x pixels + AA + logarithmic depth buffer)
2. **Memory pressure** - All the per-frame updates creating memory churn
3. **iOS WebView protection** - Aggressive context killing when limits exceeded

The "restart" behavior is the PWA/WebView recovering from context loss.

## Potential Solutions (NOT YET IMPLEMENTED)

### High Priority Fixes

1. **Clamp Pixel Ratio on Mobile**
```javascript
const pixelRatio = /iPhone|iPad|iPod/.test(navigator.userAgent) 
    ? Math.min(window.devicePixelRatio, 2.0) 
    : window.devicePixelRatio;
this.renderer.setPixelRatio(pixelRatio);
```

2. **Disable Logarithmic Depth Buffer on Mobile**
```javascript
const isMobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
this.renderer = new THREE.WebGLRenderer({ 
    canvas: this.canvas,
    antialias: !isMobile, // Disable AA on mobile
    logarithmicDepthBuffer: !isMobile
});
```

3. **Pause Expensive Updates During Interaction**
```javascript
this.controls.addEventListener('start', () => {
    this.isInteracting = true;
});
this.controls.addEventListener('end', () => {
    this.isInteracting = false;
});

// Then in animate():
if (!this.isInteracting) {
    this.updateAxesLength();
    this.updateGridSpacing();
    this.updateNumberLabelScales();
    this.updatePointSphereScales();
    this.updateVectorThickness();
}
```

4. **Increase Minimum Distance on Mobile**
```javascript
this.controls.minDistance = isMobile ? 2 : 1; // Prevent extreme zoom on mobile
```

### Medium Priority

5. **Disable damping on mobile** for better performance
6. **Use lower-quality rendering during rotation** (performance mode)
7. **Reduce max axis length in 3D mode** to decrease geometry complexity

## Testing Notes

- Test on various iOS devices to determine if this affects all 3x displays or just Pro Max models
- Monitor WebGL context loss events to confirm theory
- Profile memory usage during zoom + rotation on iPhone

## Date Discovered
February 11, 2026
