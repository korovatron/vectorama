// intersection-worker.js - Web Worker for background intersection calculations
// This worker handles computationally expensive intersection detection without blocking the UI

console.log('Intersection worker loaded');

// Import math.js for function evaluation in the worker context
importScripts('https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.0/math.min.js');

// Global cancellation flag
let isCancelled = false;

// Intersection Detection Web Worker
// Performs intersection calculations in a separate thread for better performance

// Worker message handler
self.onmessage = function(event) {
    const { type, data } = event.data;
    
    switch (type) {
        case 'TEST_COMMUNICATION':
            // Simple test to verify worker communication works
            self.postMessage({
                type: 'TEST_RESPONSE',
                data: { message: 'Worker communication successful!', timestamp: Date.now() }
            });
            break;
            
        case 'CANCEL_CALCULATION':
            // Set cancellation flag to abort current calculation
            isCancelled = true;
            self.postMessage({
                type: 'CALCULATION_CANCELLED',
                data: { timestamp: Date.now() }
            });
            break;
            
        case 'CALCULATE_INTERSECTIONS':
            try {
                // Reset cancellation flag for new calculation
                isCancelled = false;
                const startTime = performance.now();
                
                // Extract data from main thread
                const { functions, viewport, plotMode, maxResolution, calculationType } = data;
                
                // Calculate intersections using the same logic as main thread
                const intersections = findIntersections(functions, plotMode);
                
                // Check if calculation was cancelled before sending results
                if (isCancelled) {
                    return;
                }
                
                const endTime = performance.now();
                const calculationTime = endTime - startTime;
                
                // Send results back to main thread
                self.postMessage({
                    type: 'INTERSECTIONS_COMPLETE',
                    data: {
                        intersections: intersections,
                        calculationTime: calculationTime,
                        functionCount: functions.length,
                        calculationType: calculationType || 'mixed'
                    }
                });
                
            } catch (error) {
                console.error('Worker error:', error);
                self.postMessage({
                    type: 'INTERSECTIONS_ERROR',
                    data: { error: error.message }
                });
            }
            break;
            
        default:
            console.warn('Unknown message type:', type);
    }
};

// Handle worker errors
self.onerror = function(error) {
    console.error('Worker error:', error);
    self.postMessage({
        type: 'WORKER_ERROR',
        data: { error: error.message }
    });
};

// ================================
// INTERSECTION DETECTION FUNCTIONS
// ================================

function findIntersections(functions, plotMode) {
    // Find intersection points between all pairs of enabled functions
    const intersections = [];
    const enabledFunctions = functions.filter(f => f.enabled && f.points.length > 0);
    
    // Check all pairs of functions
    for (let i = 0; i < enabledFunctions.length; i++) {
        // Check for cancellation between function pairs
        if (isCancelled) {
            return [];
        }
        
        for (let j = i + 1; j < enabledFunctions.length; j++) {
            const func1 = enabledFunctions[i];
            const func2 = enabledFunctions[j];
            
            const pairIntersections = findIntersectionsBetweenFunctions(func1, func2, plotMode);
            intersections.push(...pairIntersections);
        }
    }
    
    return intersections;
}

function findIntersectionsBetweenFunctions(func1, func2, plotMode) {
    const intersections = [];
    const points1 = func1.points;
    const points2 = func2.points;
    
    if (points1.length === 0 || points2.length === 0) {
        return intersections;
    }
    
    // Check if either function is implicit (has connected segments or NaN separators)
    const isImplicit1 = points1.some(p => p.connected || !isFinite(p.x) || !isFinite(p.y));
    const isImplicit2 = points2.some(p => p.connected || !isFinite(p.x) || !isFinite(p.y));
    
    // Handle different combinations of function types
    if (isImplicit1 && isImplicit2) {
        // Both implicit - use line segment intersection
        return findImplicitIntersections(func1, func2);
    } else if (isImplicit1 || isImplicit2) {
        // Mixed explicit/implicit - use hybrid method
        return findMixedIntersections(func1, func2, isImplicit1);
    }
    
    // Both explicit - use point-based intersection detection
    
    // Original logic for explicit functions
    if (plotMode === 'cartesian') {
        // For cartesian functions, check consecutive points in both functions
        // Use the existing function points for efficiency
        for (let i = 0; i < points1.length - 1; i++) {
            // Check for cancellation every 100 iterations
            if (i % 100 === 0 && isCancelled) {
                return [];
            }
            
            const p1_current = points1[i];
            const p1_next = points1[i + 1];
            
            if (!p1_current || !p1_next) continue;
            if (!isFinite(p1_current.x) || !isFinite(p1_current.y)) continue;
            if (!isFinite(p1_next.x) || !isFinite(p1_next.y)) continue;
            
            const x1 = p1_current.x;
            const x2 = p1_next.x;
            
            // Interpolate y values for func2 at these x points
            const y1_at_x1 = p1_current.y;
            const y1_at_x2 = p1_next.y;
            const y2_at_x1 = interpolateYAtX(func2, x1);
            const y2_at_x2 = interpolateYAtX(func2, x2);
            
            if (y2_at_x1 !== null && y2_at_x2 !== null) {
                // Check for sign change in (func1 - func2)
                const diff1 = y1_at_x1 - y2_at_x1;
                const diff2 = y1_at_x2 - y2_at_x2;
                
                if (diff1 * diff2 < 0) { // Sign change detected (crossing intersection)
                    // Linear interpolation to estimate intersection point
                    const ratio = Math.abs(diff1) / (Math.abs(diff1) + Math.abs(diff2));
                    let intersectionX = x1 + ratio * (x2 - x1);
                    let intersectionY = y1_at_x1 + ratio * (y1_at_x2 - y1_at_x1);
                    
                    // Snap very close intersections to exactly origin
                    if (Math.abs(intersectionX) < 0.02) intersectionX = 0;
                    if (Math.abs(intersectionY) < 0.02) intersectionY = 0;
                    
                    intersections.push({
                        x: intersectionX,
                        y: intersectionY,
                        func1: func1,
                        func2: func2,
                        isApproximate: true
                    });
                }
            }
        }
    } else if (plotMode === 'polar') {
        // For polar functions, use line segment intersection method
        // This works better for curves that loop back or have multiple y values per x
        for (let i = 0; i < points1.length - 1; i++) {
            const p1_current = points1[i];
            const p1_next = points1[i + 1];
            
            if (!p1_current.connected || !p1_next.connected) continue;
            
            for (let j = 0; j < points2.length - 1; j++) {
                const p2_current = points2[j];
                const p2_next = points2[j + 1];
                
                if (!p2_current.connected || !p2_next.connected) continue;
                
                // Check if line segments intersect
                const intersection = findLineSegmentIntersection(
                    p1_current, p1_next, p2_current, p2_next
                );
                
                if (intersection) {
                    // Snap very close intersections to exactly origin
                    let snappedX = intersection.x;
                    let snappedY = intersection.y;
                    if (Math.abs(snappedX) < 0.02) snappedX = 0;
                    if (Math.abs(snappedY) < 0.02) snappedY = 0;
                    
                    intersections.push({
                        x: snappedX,
                        y: snappedY,
                        func1: func1,
                        func2: func2,
                        isApproximate: true
                    });
                }
            }
        }
    }
    
    return intersections;
}

function findImplicitIntersections(func1, func2) {
    const intersections = [];
    const segments1 = getLineSegments(func1.points);
    const segments2 = getLineSegments(func2.points);
    
    // Simple O(n²) approach but with reasonable segment counts
    for (const seg1 of segments1) {
        for (const seg2 of segments2) {
            const intersection = findLineSegmentIntersection(
                seg1.start, seg1.end, seg2.start, seg2.end
            );
            
            if (intersection) {
                // Reasonable duplicate filtering
                const isDuplicate = intersections.some(existing => 
                    Math.abs(existing.x - intersection.x) < 0.01 && 
                    Math.abs(existing.y - intersection.y) < 0.01
                );
                
                if (!isDuplicate) {
                    // Snap very close intersections to exactly origin
                    let snappedX = intersection.x;
                    let snappedY = intersection.y;
                    if (Math.abs(snappedX) < 0.02) snappedX = 0;
                    if (Math.abs(snappedY) < 0.02) snappedY = 0;
                    
                    intersections.push({
                        x: snappedX,
                        y: snappedY,
                        func1: func1,
                        func2: func2,
                        isApproximate: true
                    });
                }
            }
        }
    }
    
    return intersections;
}

function findMixedIntersections(func1, func2, func1IsImplicit) {
    const intersections = [];
    
    // Determine which function is explicit and which is implicit
    const explicitFunc = func1IsImplicit ? func2 : func1;
    const implicitFunc = func1IsImplicit ? func1 : func2;
    
    // Get line segments from implicit function
    const implicitSegments = getLineSegments(implicitFunc.points);
    
    // For each implicit segment, check intersection with explicit function curve
    for (const segment of implicitSegments) {
        // Find intersections between this line segment and the explicit function
        const segmentIntersections = findSegmentCurveIntersections(segment, explicitFunc, implicitFunc);
        intersections.push(...segmentIntersections);
    }
    
    return intersections;
}

function findSegmentCurveIntersections(segment, explicitFunc, implicitFunc) {
    const intersections = [];
    const { start: segStart, end: segEnd } = segment;
    
    // Validate segment coordinates
    if (isNaN(segStart.x) || isNaN(segStart.y) || isNaN(segEnd.x) || isNaN(segEnd.y)) {
        return intersections;
    }
    
    // Check intersection with each pair of consecutive points in explicit function
    for (let i = 0; i < explicitFunc.points.length - 1; i++) {
        const curveP1 = explicitFunc.points[i];
        const curveP2 = explicitFunc.points[i + 1];
        
        // Skip if curve points are invalid
        if (isNaN(curveP1.x) || isNaN(curveP1.y) || isNaN(curveP2.x) || isNaN(curveP2.y)) {
            continue;
        }
        
        // Check if line segments intersect using existing function
        const intersection = findLineSegmentIntersection(segStart, segEnd, curveP1, curveP2);
        
        if (intersection) {
            // Validate intersection coordinates
            if (isNaN(intersection.x) || isNaN(intersection.y)) {
                continue;
            }
            
            // Check for duplicates
            const isDuplicate = intersections.some(existing => 
                Math.abs(existing.x - intersection.x) < 0.01 && 
                Math.abs(existing.y - intersection.y) < 0.01
            );
            
            if (!isDuplicate) {
                // Snap very close intersections to exactly origin
                let snappedX = intersection.x;
                let snappedY = intersection.y;
                if (Math.abs(snappedX) < 0.02) snappedX = 0;
                if (Math.abs(snappedY) < 0.02) snappedY = 0;
                
                intersections.push({
                    x: snappedX,
                    y: snappedY,
                    func1: explicitFunc,
                    func2: implicitFunc,
                    isApproximate: true
                });
            }
        }
    }
    
    return intersections;
}

function getLineSegments(points) {
    const segments = [];
    
    // Extract continuous runs of valid points, create segments between consecutive points
    let i = 0;
    while (i < points.length) {
        // Skip NaN separators
        while (i < points.length && (!points[i] || !isFinite(points[i].x) || !isFinite(points[i].y))) {
            i++;
        }
        
        // Collect continuous run of valid points
        const runStart = i;
        while (i < points.length && points[i] && isFinite(points[i].x) && isFinite(points[i].y)) {
            i++;
        }
        
        // Create segments from consecutive points in this run
        for (let j = runStart; j < i - 1; j++) {
            segments.push({
                start: points[j],
                end: points[j + 1]
            });
        }
    }
    
    return segments;
}

function findLineSegmentIntersection(p1, p2, p3, p4) {
    // Find intersection between line segments (p1,p2) and (p3,p4)
    // Using parametric line intersection algorithm
    
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    // Lines are parallel or coincident
    if (Math.abs(denom) < 1e-10) {
        return null;
    }
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        let x = x1 + t * (x2 - x1);
        let y = y1 + t * (y2 - y1);
        
        // Snap very close intersections to exactly origin
        if (Math.abs(x) < 0.02) x = 0;
        if (Math.abs(y) < 0.02) y = 0;
        
        return { x, y };
    }
    
    return null;
}

function interpolateYAtX(func, targetX) {
    const points = func.points;
    if (points.length === 0) return null;
    
    // Check if this is an implicit function (has disconnected segments)
    const hasDisconnectedSegments = points.some(p => !isFinite(p.x) || !isFinite(p.y));
    
    if (hasDisconnectedSegments) {
        // For implicit functions, only use exact matches or very close points
        // Don't interpolate across disconnected segments
        let closestPoint = null;
        let minDistance = Infinity;
        
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (isFinite(point.x) && isFinite(point.y)) {
                const distance = Math.abs(point.x - targetX);
                if (distance < minDistance && distance < 0.01) { // Very close threshold
                    minDistance = distance;
                    closestPoint = point;
                }
            }
        }
        
        return closestPoint ? closestPoint.y : null;
    }
    
    // For explicit functions, use interpolation with asymptote detection
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        // Check if targetX is between these points
        if (p1.x <= targetX && targetX <= p2.x) {
            // Check if both points are finite (not NaN)
            if (!isFinite(p1.y) || !isFinite(p2.y)) {
                return null; // Can't interpolate across discontinuity
            }
            
            // Check for large jumps (asymptotes) - use conservative threshold
            // Without viewport context, use absolute threshold
            const yDiff = Math.abs(p2.y - p1.y);
            const xDiff = Math.abs(p2.x - p1.x);
            
            // Detect asymptotes: very large Y change over small X change
            if (xDiff > 0 && yDiff / xDiff > 100) {
                return null; // Don't interpolate across likely asymptote
            }
            
            // Linear interpolation
            const ratio = (targetX - p1.x) / (p2.x - p1.x);
            return p1.y + ratio * (p2.y - p1.y);
        }
    }
    
    return null; // targetX is outside the function's domain
}