/*
    <div id="selection-screen" style="width: 1600px; height: 500px; position: relative; overflow: hidden; border-radius: 8px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
        <!-- UI Elements go here, layered on top of the canvas via absolute positioning -->
    </div>
    <script type="module">
        import GalaxyBackground from './GalaxyBackground.js';
        
        const container = document.getElementById('selection-screen');
        const galaxy = new GalaxyBackground(container);
    </script>
 */
const CONFIG = {
    // --- CAMERA & VIEW ---
    offsetX: 0.0,           // Move galaxy center left/right (positive = right)
    offsetY: -0.0,          // Move galaxy center up/down (positive = up)
    camDist: 1.5,           // Distance from camera to galaxy
    fov: 5.0,               // Field of view (higher = wider)
    aspectSpread: 0.45,     // How much to stretch the galaxy horizontally
    pitchCos: 0.866,        // Camera tilt (pitch). 0.866 / 0.5 = ~30 deg
    pitchSin: 0.5,          
    yawCos: 0.9848,         // Camera rotation (yaw). 0.9848 / 0.1736 = ~10 deg
    yawSin: 0.1736,         
    
    // --- SHADER GLOBALS ---
    nebulaShaderAlpha: 1.65, // Global opacity multiplier for all gas clouds
    starSizeMultiplier: 4.0, // Global size multiplier for all stars
    starBrightnessMultiplier: 1.0, // Global brightness multiplier for all stars
    
    // --- ANIMATION SPEED ---
    globalTimeSpeed: 1.0,    // Multiplier for everything (twinkle, waves, and orbit)
    orbitSpeed: 0.5,         // Multiplier for ONLY the rotation speed of the galaxy

    // --- GALAXY STRUCTURE ---
    arms: 2,                 // Number of spiral arms
    spiralTightness: 1.5,    // How tightly the arms wind (lower = looser)
    
    // --- PARTICLES: { count, spread, size: [min, max], alpha: [min, max] } ---
    core:     { count: 1500/4, spread: 0.8, size: [1.5, 5.5],   alpha: [0.1, 0.25] },
    armStars: { count: 8000/4, spread: 7.5, size: [1.5, 5.5],   alpha: [0.3, 0.8]  },
    nebula:   { count: 3500/4, spread: 8.0, size: [20.0, 60.0], alpha: [0.06, 0.12] },
    bgStars:  { count: 2000/4,              size: [0.5, 3.0],   alpha: [0.15, 0.5] }
};

// Helper to ensure WebGL gets floats for shader injection (e.g., 5 becomes "5.0")
const f = (n) => Number.isInteger(n) ? n.toFixed(1) : n.toString();

export default class GalaxyBackground {
    constructor(containerElement) {
        this.container = containerElement;

        // Setup Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.canvas.style.pointerEvents = 'none';
        this.container.appendChild(this.canvas);

        if (getComputedStyle(this.container).position === 'static') {
            this.container.style.position = 'relative';
        }

        this.gl = this.canvas.getContext('webgl', { 
            alpha: true, 
            depth: false, 
            premultipliedAlpha: true,
            antialias: false 
        });

        if (!this.gl) throw new Error("WebGL not supported");

        this.totalParticles = CONFIG.core.count + CONFIG.armStars.count + CONFIG.nebula.count + CONFIG.bgStars.count;
        this.time = 0;

        this.initShaders();
        this.initParticles();
        this.initEvents();

        this.resize();
        this.animate = this.animate.bind(this);
        this.lastTime = performance.now();
        requestAnimationFrame(this.animate);
    }

    initShaders() {
        const vsSource = `
            precision highp float;
            attribute vec3 a_coords;    // (radius/x, angle/y, height/z)
            attribute vec4 a_color;     // (r, g, b, alpha)
            attribute vec3 a_params;    // (size, speed, type: 0=star, 1=nebula, 2=bg)

            uniform float u_time;
            uniform float u_aspect;

            varying vec4 v_color;
            varying float v_type;

            void main() {
                v_type = a_params.z;
                vec3 pos;

                if (a_params.z < 1.5) {
                    float r = a_coords.x;
                    float baseAngle = a_coords.y;
                    float z = a_coords.z;
                    float speed = a_params.y;

                    // Super slow deep-space movement (natural visual orbital decay)
                    float angVel = (speed * 0.03 * ${f(CONFIG.orbitSpeed)}) / (r * 0.5 + 0.1);
                    float theta = baseAngle - u_time * angVel;

                    // Subtle organic waves for interstellar gas
                    if (a_params.z > 0.5) {
                        float wave1 = sin(u_time * 0.05 + r * 3.0 + baseAngle * 2.0);
                        r += wave1 * 0.05;
                        z += sin(u_time * 0.08 + r * 2.0) * 0.04;
                    }

                    float gx = r * cos(theta);
                    float gy = r * sin(theta);
                    float gz = z;

                    // Tilt the galaxy (pitch ~30 degrees to avoid the flat edge-on line)
                    float cosP = ${f(CONFIG.pitchCos)}; 
                    float sinP = ${f(CONFIG.pitchSin)}; 
                    float py = gy * cosP - gz * sinP;
                    float pz = gy * sinP + gz * cosP;

                    // Slight yaw
                    float cosY = ${f(CONFIG.yawCos)}; 
                    float sinY = ${f(CONFIG.yawSin)}; 
                    float px = gx * cosY - pz * sinY;
                    pz = gx * sinY + pz * cosY;

                    // Offset to move the center of the galaxy in the view
                    pos = vec3(px + ${f(CONFIG.offsetX)}, py + ${f(CONFIG.offsetY)}, pz);
                } else {
                    // Back star parallax
                    pos = a_coords;
                    pos.x += sin(u_time * 0.02 + a_params.y) * 0.05;
                    pos.y += cos(u_time * 0.015 + a_params.y) * 0.05;
                }

                float camDist = ${f(CONFIG.camDist)};
                float depth = camDist + pos.z;
                float fov = ${f(CONFIG.fov)}; 
                vec2 projected = (pos.xy * fov) / depth;

                // Stop perfect-circle aspect constraint; allow it to spread across widescreen
                projected.x /= (u_aspect * ${f(CONFIG.aspectSpread)});

                gl_Position = vec4(projected, pos.z * 0.01, 1.0);

                float size = a_params.x * (fov / depth);
                if (a_params.z > 0.5 && a_params.z < 1.5) {
                    size *= 1.0 + 0.2 * sin(u_time * 0.2 + a_coords.y * 3.0);
                } else {
                    size *= ${f(CONFIG.starSizeMultiplier)};
                }

                float twinkle = 1.0;
                if (a_params.z < 0.5 || a_params.z > 1.5) {
                    twinkle = 0.7 + 0.3 * sin(u_time * 2.5 + a_coords.y * 15.0);
                    twinkle *= ${f(CONFIG.starBrightnessMultiplier)};
                }

                gl_PointSize = max(1.0, size);
                v_color = vec4(a_color.rgb, a_color.a * twinkle);
            }
        `;

        const fsSource = `
            precision mediump float;
            varying vec4 v_color;
            varying float v_type;

            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;

                float alpha;
                if (v_type > 0.5 && v_type < 1.5) {
                    // Nebula: softer, much darker falloff to prevent white-out blur
                    float norm = dist * 2.0; 
                    float falloff = pow(max(0.0, 1.0 - norm), 1.8);
                    alpha = falloff * ${f(CONFIG.nebulaShaderAlpha)};
                } else {
                    // Stars: sharp focus
                    float core = exp(-dist * 25.0);
                    float halo = exp(-dist * 5.0);
                    alpha = clamp(core * 0.9 + halo * 0.1, 0.0, 1.0);
                    alpha *= (1.0 - smoothstep(0.2, 0.5, dist));
                }

                gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
            }
        `;

        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fsSource);

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);
        this.gl.useProgram(this.program);

        this.uTimeLoc = this.gl.getUniformLocation(this.program, 'u_time');
        this.uAspectLoc = this.gl.getUniformLocation(this.program, 'u_aspect');
    }

    initParticles() {
        const coords = new Float32Array(this.totalParticles * 3);
        const colors = new Float32Array(this.totalParticles * 4);
        const params = new Float32Array(this.totalParticles * 3);

        let idx = 0;

        // 1. CORE
        for (let i = 0; i < CONFIG.core.count; i++, idx++) {
            const r = Math.pow(Math.random(), 1.8) * CONFIG.core.spread;
            const theta = Math.random() * Math.PI * 2;
            const z = (Math.random() - 0.5) * 0.15 * (1.0 - r);

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            const warmTone = Math.random();
            colors[idx * 4] = 1.0;                             // R
            colors[idx * 4 + 1] = 0.8 + warmTone * 0.2;        // G
            colors[idx * 4 + 2] = 0.7 + warmTone * 0.3;        // B
            colors[idx * 4 + 3] = CONFIG.core.alpha[0] + Math.random() * (CONFIG.core.alpha[1] - CONFIG.core.alpha[0]);

            params[idx * 3 + 1] = 0.5 + Math.random() * 0.2;
            params[idx * 3 + 2] = 0.0;
            params[idx * 3] = Math.random() * (CONFIG.core.size[1] - CONFIG.core.size[0]) + CONFIG.core.size[0];
        }

        // 2. SWEEPING SPIRAL ARMS
        for (let i = 0; i < CONFIG.armStars.count; i++, idx++) {
            const armIndex = i % CONFIG.arms;
            const armAngle = (armIndex * Math.PI); 

            const r = 0.1 + Math.pow(Math.random(), 1.2) * CONFIG.armStars.spread;
            const spiralAngle = armAngle + r * CONFIG.spiralTightness; 
            // Tighten spread near the core, fan out at the edges
            const spread = (Math.random() - 0.5) * (Math.random() * 0.6) * (1.0 + r * 0.5);
            const theta = spiralAngle + spread;
            const z = (Math.random() - 0.5) * 0.08 * Math.exp(-r * 0.3);

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            // Deep luxury colors: icy blues, deep indigos, sparse magenta
            const t = Math.random();
            if (t < 0.6) {
                colors[idx * 4] = 0.4 + Math.random() * 0.2;   // Ice Blue
                colors[idx * 4 + 1] = 0.7 + Math.random() * 0.3;
                colors[idx * 4 + 2] = 1.0;
            } else if (t < 0.9) {
                colors[idx * 4] = 0.1;                         // Deep Indigo
                colors[idx * 4 + 1] = 0.2 + Math.random() * 0.2;
                colors[idx * 4 + 2] = 0.9;
            } else {
                colors[idx * 4] = 0.9;                         // Sparse Magenta
                colors[idx * 4 + 1] = 0.2 + Math.random() * 0.2;
                colors[idx * 4 + 2] = 0.6;
            }
            colors[idx * 4 + 3] = CONFIG.armStars.alpha[0] + Math.random() * (CONFIG.armStars.alpha[1] - CONFIG.armStars.alpha[0]);

            params[idx * 3 + 1] = 0.3 + Math.random() * 0.1;
            params[idx * 3 + 2] = 0.0;
            params[idx * 3] = Math.random() * (CONFIG.armStars.size[1] - CONFIG.armStars.size[0]) + CONFIG.armStars.size[0];
        }

        // 3. SUBTLE SPACE CLOUDS (Darker, richer, less opaque)
        for (let i = 0; i < CONFIG.nebula.count; i++, idx++) {
            const armIndex = i % CONFIG.arms;
            const armAngle = (armIndex * Math.PI);

            const r = Math.pow(Math.random(), 1.1) * CONFIG.nebula.spread;
            const spiralAngle = armAngle + r * CONFIG.spiralTightness;
            const spread = (Math.random() - 0.5) * (0.4 + r * 0.6);
            const theta = spiralAngle + spread;
            const z = (Math.random() - 0.5) * 0.2;

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            const paletteChoice = Math.random();
            if (paletteChoice < 0.5) {
                colors[idx * 4] = 0.02;                        // Deep Void Blue
                colors[idx * 4 + 1] = 0.05;
                colors[idx * 4 + 2] = 0.25;
            } else if (paletteChoice < 0.8) {
                colors[idx * 4] = 0.15;                        // Dark Violet
                colors[idx * 4 + 1] = 0.02;
                colors[idx * 4 + 2] = 0.25;
            } else {
                colors[idx * 4] = 0.01;                        // Subtle Cyan Dust
                colors[idx * 4 + 1] = 0.15;
                colors[idx * 4 + 2] = 0.2;
            }
            
            colors[idx * 4 + 3] = CONFIG.nebula.alpha[0] + Math.random() * (CONFIG.nebula.alpha[1] - CONFIG.nebula.alpha[0]);

            params[idx * 3] = Math.random() * (CONFIG.nebula.size[1] - CONFIG.nebula.size[0]) + CONFIG.nebula.size[0]; 
            params[idx * 3 + 1] = 0.25 + Math.random() * 0.1;
            params[idx * 3 + 2] = 1.0; // 1 = nebula
        }

        // 4. DEEP BACKGROUND STARFIELD
        for (let i = 0; i < CONFIG.bgStars.count; i++, idx++) {
            coords[idx * 3] = (Math.random() - 0.5) * 20.0;
            coords[idx * 3 + 1] = (Math.random() - 0.5) * 12.0;
            coords[idx * 3 + 2] = (Math.random() - 0.5) * 5.0;

            colors[idx * 4] = 0.6 + Math.random() * 0.4;
            colors[idx * 4 + 1] = 0.7 + Math.random() * 0.3;
            colors[idx * 4 + 2] = 1.0;
            colors[idx * 4 + 3] = CONFIG.bgStars.alpha[0] + Math.random() * (CONFIG.bgStars.alpha[1] - CONFIG.bgStars.alpha[0]);

            params[idx * 3] = Math.random() * (CONFIG.bgStars.size[1] - CONFIG.bgStars.size[0]) + CONFIG.bgStars.size[0];
            params[idx * 3 + 1] = Math.random() * 6.28;
            params[idx * 3 + 2] = 2.0; // 2 = background
        }

        this.bindBuffer('a_coords', coords, 3);
        this.bindBuffer('a_color', colors, 4);
        this.bindBuffer('a_params', params, 3);
    }

    bindBuffer(attributeName, data, size) {
        const buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);

        const location = this.gl.getAttribLocation(this.program, attributeName);
        this.gl.enableVertexAttribArray(location);
        this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, 0, 0);
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
        }
        return shader;
    }

    initEvents() {
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        const width = rect.width || 1600;
        const height = rect.height || 500;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.canvas.width = Math.floor(width * dpr);
        this.canvas.height = Math.floor(height * dpr);
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        this.aspect = width / height;
    }

    animate(now) {
        const delta = (now - this.lastTime) * 0.001;
        this.lastTime = now;
        this.time += delta * CONFIG.globalTimeSpeed;

        this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE);

        this.gl.uniform1f(this.uTimeLoc, this.time);
        this.gl.uniform1f(this.uAspectLoc, this.aspect);

        this.gl.drawArrays(this.gl.POINTS, 0, this.totalParticles);

        this.animationId = requestAnimationFrame(this.animate);
    }

    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this.resize);
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
        this.canvas.remove();
    }
}