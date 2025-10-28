const shapes = document.querySelectorAll('.shape');
shapes.forEach(shape => {
    let x = Math.random() * window.innerWidth;
    let y = Math.random() * window.innerHeight;
    let dx = (Math.random() - 0.5) * 1.5;
    let dy = (Math.random() - 0.5) * 1.5;
    shape.style.left = x + 'px';
    shape.style.top = y + 'px';

    function animate() {
        x += dx;
        y += dy;

        
        if (x < 0 || x + shape.offsetWidth > window.innerWidth) dx *= -1;
        if (y < 0 || y + shape.offsetHeight > window.innerHeight) dy *= -1;

        shape.style.left = x + 'px';
        shape.style.top = y + 'px';

        requestAnimationFrame(animate);
    }

    animate();
});