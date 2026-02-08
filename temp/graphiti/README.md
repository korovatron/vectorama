# Graphiti

An advanced Progressive Web App (PWA) for plotting and exploring mathematical functions with real-time analysis and smooth, high-performance interactions.

## Features

### Function Plotting

**Multiple Coordinate Systems**
- **Cartesian Mode**: Plot explicit functions `y = f(x)` and implicit relations like circles, ellipses, and general curves
- **Polar Mode**: Plot polar functions `r = f(θ)` and rays `θ = constant`
- Seamless switching between coordinate systems

**Function Types**
- Explicit functions: `y = x²`, `y = sin(x)`, `y = e^x`
- Implicit functions: `x² + y² = 25`, `x²/9 + y²/4 = 1`
- Polar functions: `r = cos(2θ)`, `r = 1 + sin(θ)`
- Polar rays: `θ = π/4`, `θ = 1.5`
- Support for asymptotic functions: `y = tan(x)`, `y = 1/x`

**Mathematical Input**
- Beautiful LaTeX-style mathematical notation with MathLive
- Virtual mathematical keyboard with common functions and symbols
- Automatic conversion of plain text to LaTeX
- Support for implicit multiplication: `2x`, `x(x+1)`
- Quick symbol insertion: type `pi` for π, `theta` for θ in polar mode
- Inline shortcuts for function names (see Function Reference below)

### Mathematical Analysis

**Tangent Line Tracing**
- Click any function curve to trace the tangent line at that point
- Shows slope/gradient value in a badge
- Multiple tangent traces per function
- Works in both Cartesian and polar modes
- Visual tangent line extension across viewport

**Intersection Detection**
- Automatic detection of function intersections using Web Worker (non-blocking)
- Support for explicit-explicit, explicit-implicit, and implicit-implicit intersections
- Accurate bisection method for precise intersection coordinates
- Visual markers with coordinate badges

**Axis Intercepts**
- X-intercepts: points where functions cross the x-axis
- Y-intercepts: points where functions cross the y-axis
- Intelligent density culling to avoid overcrowding
- Bisection refinement for accurate coordinates

**Turning Points (Stationary Points)**
- Automatic detection of local maxima and minima
- Classification of turning point types
- Works for both Cartesian and polar functions
- Visual distinction between different types

**Interactive Tracing**
- Click any function to create a trace badge showing exact coordinates
- Click while holding Shift to trace tangent line with slope/gradient
- Multiple trace points per function
- Snap to nearest point on curve
- Tangent line extends across the entire viewport

### Visualization & Interaction

**High-Performance Rendering**
- 60-75 FPS during pan/zoom with multiple functions
- Optimized buffered rendering with 50% overscan
- Debounced recalculation (100ms) for smooth interaction
- Canvas 2D rendering with browser optimizations

**Navigation**
- **Mouse**: Click-drag to pan, scroll wheel to zoom
- **Touch**: Single-finger pan, two-finger pinch-to-zoom (with directional support)
- **Keyboard**: Arrow keys or WASD to pan, +/- to zoom
- Adaptive zoom: horizontal, vertical, or uniform pinch gestures
- Reset view button to return to default axes

**Visual Features**
- Adaptive grid with intelligent spacing (powers of 10, halves, quarters, π-based, fractions)
- Smart axis labels with π fractions and rational number formatting
- Color-coded functions with customizable colors
- Asymptote detection and proper discontinuity handling
- Coordinate display snapping for clean values near axes
- Frozen badges during interaction for visual continuity
- Smooth animations and transitions
- Radical notation for square roots (√2, √3, etc.)
- Mathematical formatting for special values

### Display Options

**Theme Support**
- Dark mode (default): Charcoal canvas for reduced eye strain
- Light mode: Clean white canvas for printing/presentations
- UI remains dark-themed for consistency

**Angle Modes**
- Radians (default): Scientific standard
- Degrees: Educational/practical applications
- Affects polar functions and trig function display

**Toggle Features**
- Show/hide intersections
- Show/hide intercepts
- Show/hide turning points
- Show/hide tangent traces
- Individual function enable/disable

### User Interface

**Function Panel**
- Add multiple functions (up to 8 recommended for performance)
- Color picker for each function
- Quick function examples dropdown
- Cartesian and polar example libraries
- Delete functions individually

**Viewport Controls**
- Manual X and Y range inputs
- Theta range controls for polar mode
- Negative r plotting option for polar functions
- Real-time validation and error feedback

**Performance Monitoring** (Ctrl+Shift+P)
- Real-time FPS counter
- Per-function plot time display
- Intersection calculation time
- Total point count
- Color-coded performance indicators

**Keyboard Shortcuts** (Press ? to view)
- Navigation: Arrow keys or WASD
- Zoom: +/- keys
- Quick help: ? key
- Close menus: Esc key

### Technical Features

**PWA Capabilities**
- Offline support with service worker
- Installable on desktop and mobile
- Full-screen mobile support
- Safe area support for notched displays
- Responsive design for all screen sizes

**Performance Optimizations**
- Buffered point calculation (50% overscan) for gap-free panning
- Cached intercept culling to prevent O(n²) operations
- Debounced viewport recalculation
- Web Worker for non-blocking intersection calculations
- Marching squares algorithm for implicit functions with display point caching
- Adaptive resolution based on function count

**Mobile Optimizations**
- Landscape orientation editing restrictions on phones
- Touch-friendly interface with large tap targets
- Virtual keyboard optimization
- Battery-efficient rendering
- Reduced CPU usage during interaction

## Browser Support

- Modern browsers with Canvas 2D and Web Worker support
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Libraries Used

- **MathLive**: LaTeX mathematical notation input
- **Math.js**: Safe mathematical expression evaluation
- **Web Workers**: Non-blocking intersection calculations
- **Service Worker**: PWA offline support

## Performance

- **Normal usage** (1-5 functions): 70-75 FPS
- **Heavy usage** (8 functions with analysis): 60+ FPS
- **Adaptive resolution**: 2000 points (≤6 functions), 1200 points (≤10 functions), 800 points (>10 functions)
- **Intersection calculation**: Non-blocking via Web Worker
- **Battery efficient**: Minimal recalculation during interaction

## Usage Tips

1. **Start Simple**: Begin with one or two functions to understand the interface
2. **Use Examples**: Click the dropdown arrow next to "Add Function" for pre-built examples
3. **Keyboard Shortcuts**: Press ? to see all available shortcuts
4. **Performance**: Keep function count ≤8 for optimal performance with all analysis features enabled
5. **Themes**: Toggle light/dark mode based on your environment
6. **Analysis**: Enable intersections/intercepts/turning points as needed - they update automatically
7. **Tracing**: Click any function curve to place a coordinate trace marker
8. **Tangent Lines**: Hold Shift while clicking to trace the tangent line and see the slope
9. **Typing Functions**: See Function Reference below for supported syntax when typing on keyboard

## Function Reference

When typing functions on a physical keyboard, use these formats. MathLive will automatically recognize and format them correctly.

### Basic Functions

**Trigonometric**
- `sin(x)`, `cos(x)`, `tan(x)`
- `sec(x)`, `csc(x)`, `cot(x)`

**Inverse Trigonometric** (use arc-prefix consistently)
- `arcsin(x)`, `arccos(x)`, `arctan(x)`
- `arcsec(x)`, `arccsc(x)`, `arccot(x)`
- Alternative: `asin(x)`, `acos(x)`, `atan(x)`, etc.

**Hyperbolic**
- `sinh(x)`, `cosh(x)`, `tanh(x)`
- `sech(x)`, `csch(x)`, `coth(x)`

**Inverse Hyperbolic** (use arc-prefix consistently)
- `arcsinh(x)`, `arccosh(x)`, `arctanh(x)`
- `arcsech(x)`, `arccsch(x)`, `arccoth(x)`
- Alternative: `asinh(x)`, `acosh(x)`, `atanh(x)`, etc.

**Exponential & Logarithmic**
- `exp(x)` - exponential (e^x)
- `ln(x)` - natural logarithm (base e)
- `log(x)` - base-10 logarithm
- For other bases, use the change of base formula: log_b(x) = ln(x)/ln(b)

**Roots & Powers**
- `sqrt(x)` - square root
- `cbrt(x)` - cube root
- `x^2` - powers (use ^ key)
- `x^(1/3)` - fractional powers

**Other Functions**
- `abs(x)` - absolute value
- `pi` - π constant
- `e` - Euler's number

### Typing Tips

1. **Inline Shortcuts**: When you type function names like `arcsin` or `asinh` followed by `(`, MathLive automatically formats them correctly
2. **Implicit Multiplication**: `2sin(x)` works as `2*sin(x)`, `xcos(x)` works as `x*cos(x)`
3. **Constants**: Type `pi` for π
4. **Polar Mode**: Type `theta` for θ, or just `t` (automatically converts to θ)
5. **Fractions**: Use `/` or the fraction button from virtual keyboard
6. **Parentheses**: Required for function arguments: `sin(x)`, not `sinx`

### Examples

**Cartesian Mode**
- `y = 2arcsin(x/3)` - inverse trig with scaling
- `y = exp(-x^2)` - Gaussian curve
- `y = ln(abs(x))` - logarithm with absolute value
- `y = arcsinh(x)` - inverse hyperbolic
- `x^2 + y^2 = 25` - implicit circle

**Polar Mode**
- `r = sin(3theta)` - rose curve
- `r = 1 + cos(theta)` - cardioid
- `r = exp(theta/10)` - spiral
- `theta = pi/4` - ray at 45°

## License

MIT License - See LICENSE file for details

## Author

Neil Kendall - [www.korovatron.co.uk](https://www.korovatron.co.uk)
