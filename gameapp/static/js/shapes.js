// Shape factory and helpers extracted from game.js
(function(window, Matter){
    const { Bodies, Body } = Matter;

    function randomColor() { return `hsl(${Math.floor(Math.random()*360)},70%,50%)`; }

    function makeRegularPolygonVertices(sides, radius) {
        const verts = [];
        for (let i = 0; i < sides; i++) {
            const theta = (Math.PI * 2 * i) / sides - Math.PI / 2;
            verts.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
        }
        return verts;
    }

    function makeStarVertices(radius, points, innerRatio) {
        const verts = [];
        const totalVertices = points * 2;
        const step = (Math.PI * 2) / totalVertices;
        
        for (let i = 0; i < totalVertices; i++) {
            const r = (i % 2 === 0) ? radius : radius * innerRatio;
            const angle = i * step - Math.PI / 2;
            
            // Generate vertices relative to (0, 0)
            verts.push({
                x: Math.cos(angle) * r,
                y: Math.sin(angle) * r
            });
        }
        return verts;
    }

    function createPiece(type, x, y, size, options = {}) {
        type = (type || '').toLowerCase();
        const o = Object.assign({}, options);

        switch (type) {
            case 'rectangle': {
                const w = Math.round(size * 1.6);
                const h = Math.round(size);
                return Bodies.rectangle(x, y, w, h, o);
            }

            case 'diamond': {
                const vertExt = Math.round(size * 1.6);    // extend vertical points
                const horizHalf = Math.round(size * 0.6);  // narrower horizontal half-width
                const verts = [
                    { x: 0, y: -vertExt },
                    { x: horizHalf, y: 0 },
                    { x: 0, y: vertExt },
                    { x: -horizHalf, y: 0 }
                ];
                return Bodies.fromVertices(x, y, [verts], o, true);
            }

            case 'triangle': {
                const verts = makeRegularPolygonVertices(3, size);
                return Bodies.fromVertices(x, y, [verts], o, true);
            }

            case 'pentagon': {
                const verts = makeRegularPolygonVertices(5, size);
                return Bodies.fromVertices(x, y, [verts], o, true);
            }

            case 'star': {
                const points = options.points || 5;
                const innerRatio = (typeof options.innerRatio === 'number') ? options.innerRatio : 0.5;
                const radius = size;
                const verts = makeStarVertices(radius, points, innerRatio);
                
                return Bodies.fromVertices(x, y, [verts], o, true);
            }

            case 'semicircle': {
                const radius = size;
                const segments = Math.max(8, Math.round(radius / 1.5));
                const verts = [];
                const angleStep = Math.PI / segments;
                for (let i = 0; i <= segments; i++) {
                    const angle = i * angleStep;
                    const xOff = Math.cos(angle) * radius;
                    const yOff = Math.sin(angle) * radius;
                    verts.push({ x: xOff, y: yOff });
                }
                return Bodies.fromVertices(x, y, [verts], o, true);
            }

            default: {
                const w = Math.round(size * 1.6);
                const h = Math.round(size);
                return Bodies.rectangle(x, y, w, h, o);
            }
        }
    }

    // expose as a small namespace
    window.ShapeFactory = {
        randomColor,
        createPiece,
        makeRegularPolygonVertices
    };

})(window, Matter);
