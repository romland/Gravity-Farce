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

        // Keep the GPU count highly optimized but much more visible
        this.totalParticles = 14500;
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
                    float angVel = (speed * 0.085) / (r * 0.7 + 0.3);
                    float theta = baseAngle + u_time * angVel;

                    // Highly organic, larger waves on interstellar gas to give depth
                    if (a_params.z > 0.5) {
                        float wave1 = sin(u_time * 0.08 + r * 2.8 + baseAngle * 1.5);
                        float wave2 = cos(u_time * 0.05 + baseAngle * 2.5);
                        r += wave1 * 0.16;
                        theta += wave2 * 0.09;
                        z += sin(u_time * 0.1 + r * 1.8) * 0.06;
                    }

                    float gx = r * cos(theta);
                    float gy = r * sin(theta);
                    float gz = z;

                    // Angle calculation (24-degree camera pitch and natural yaw)
                    float cosP = 0.9135; 
                    float sinP = 0.4067; 
                    float py = gy * cosP - gz * sinP;
                    float pz = gy * sinP + gz * cosP;

                    float cosY = 0.9781; 
                    float sinY = 0.2079; 
                    float px = gx * cosY - pz * sinY;
                    pz = gx * sinY + pz * cosY;

                    pos = vec3(px, py, pz);
                } else {
                    // Back star parallax
                    pos = a_coords;
                    pos.x += sin(u_time * 0.03 + a_params.y) * 0.1;
                    pos.y += cos(u_time * 0.02 + a_params.y) * 0.1;
                }

                // Smooth cinematic zoom & scale values
                float camDist = 2.4;
                float depth = camDist + pos.z;
                float fov = 3.9; 
                vec2 projected = (pos.xy * fov) / depth;

                // Spreads the galaxy organically across a widescreen element
                projected.x /= (u_aspect * 0.38);

                gl_Position = vec4(projected, pos.z * 0.01, 1.0);

                // Depth scaling that maintains large visible clouds on any screen scale
                float size = a_params.x * (fov / depth);
                if (a_params.z > 0.5 && a_params.z < 1.5) {
                    size *= 1.0 + 0.35 * sin(u_time * 0.3 + a_coords.y * 2.0);
                }

                float twinkle = 1.0;
                if (a_params.z < 0.5 || a_params.z > 1.5) {
                    twinkle = 0.65 + 0.35 * sin(u_time * 3.2 + a_coords.y * 12.0);
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
                    // Massive Volumetric Fog/Nebula. Non-linear gamma for rich cloud textures
                    float norm = dist * 2.0; 
                    float falloff = pow(max(0.0, 1.0 - norm), 1.6);
                    alpha = falloff * 0.42; 
                } else {
                    // Stars: sharp focus
                    float core = exp(-dist * 22.0);
                    float halo = exp(-dist * 4.2);
                    alpha = clamp(core * 0.85 + halo * 0.15, 0.0, 1.0);
                    alpha *= (1.0 - smoothstep(0.18, 0.5, dist));
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

        const arms = 3;
        const armParticles = 6500;
        const coreParticles = 2000;
        const nebulaParticles = 4500;
        const backgroundStars = 1500;

        let idx = 0;

        // 1. DENSE WARM CORE (High-visibility fallback)
        for (let i = 0; i < coreParticles; i++, idx++) {
            const r = Math.pow(Math.random(), 1.8) * 0.55;
            const theta = Math.random() * Math.PI * 2;
            const z = (Math.random() - 0.5) * 0.25 * (1.0 - r);

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            const warmTone = Math.random();
            colors[idx * 4] = 1.0;                           // R
            colors[idx * 4 + 1] = 0.52 + warmTone * 0.32;    // G
            colors[idx * 4 + 2] = 0.18 + warmTone * 0.22;    // B
            colors[idx * 4 + 3] = 0.32 + Math.random() * 0.25; // Much higher core baseline alpha

            params[idx * 3 + 1] = 0.35 + Math.random() * 0.1;
            params[idx * 3 + 2] = 0.0;
            params[idx * 3] = Math.random() * 6.0 + 3.0; // Enlarge slightly for viewability
        }

        // 2. VIBRANT SPIRAL ARMS
        for (let i = 0; i < armParticles; i++, idx++) {
            const armIndex = i % arms;
            const armAngle = (armIndex * (Math.PI * 2)) / arms;

            const r = 0.12 + Math.pow(Math.random(), 1.05) * 3.2; // Wide reach past edges
            const spiralAngle = armAngle + 2.05 * Math.log(r + 0.35);
            const spread = (Math.random() - 0.5) * (0.28 + r * 0.38);
            const theta = spiralAngle + spread;
            const z = (Math.random() - 0.5) * 0.16 * Math.exp(-r * 0.45);

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            // Highly saturated separation: Deep Coral Red, Ultraviolet Violet, Aqua-Cyan
            const t = r / 3.2;
            if (t < 0.3) {
                colors[idx * 4] = 0.98;                         // Warm Violet-Pink
                colors[idx * 4 + 1] = 0.2 + Math.random() * 0.15;
                colors[idx * 4 + 2] = 0.65;
            } else if (t < 0.65) {
                colors[idx * 4] = 0.55;                        // Deep ultraviolet
                colors[idx * 4 + 1] = 0.12;
                colors[idx * 4 + 2] = 0.95;
            } else {
                colors[idx * 4] = 0.02;                        // Vibrant Aqua Teal
                colors[idx * 4 + 1] = 0.75 + Math.random() * 0.22;
                colors[idx * 4 + 2] = 0.95;
            }
            colors[idx * 4 + 3] = 0.42 + Math.random() * 0.38; // Up-scaled star clarity

            params[idx * 3 + 1] = 0.28 + Math.random() * 0.08;
            params[idx * 3 + 2] = 0.0;
            params[idx * 3] = Math.random() * 4.8 + 2.2;
        }

        // 3. STRONG INTERSTELLAR CLOUDS (Massive, non-pixelated overlapping dust)
        for (let i = 0; i < nebulaParticles; i++, idx++) {
            const armIndex = i % arms;
            const armAngle = (armIndex * (Math.PI * 2)) / arms;

            const isAmbient = Math.random() < 0.32;
            const r = isAmbient ? Math.random() * 3.8 : 0.15 + Math.pow(Math.random(), 1.05) * 3.1;
            const spiralAngle = armAngle + 2.05 * Math.log(r + 0.35);
            const spread = isAmbient ? (Math.random() - 0.5) * 3.8 : (Math.random() - 0.5) * (0.38 + r * 0.42);
            const theta = spiralAngle + spread;
            const z = (Math.random() - 0.5) * 0.32;

            coords[idx * 3] = r;
            coords[idx * 3 + 1] = theta;
            coords[idx * 3 + 2] = z;

            const paletteChoice = Math.random();
            if (paletteChoice < 0.25) {
                colors[idx * 4] = 0.02;                        // Electric teal
                colors[idx * 4 + 1] = 0.82;
                colors[idx * 4 + 2] = 0.68;
            } else if (paletteChoice < 0.5) {
                colors[idx * 4] = 0.95;                        // Bright Nebula pink
                colors[idx * 4 + 1] = 0.18;
                colors[idx * 4 + 2] = 0.48;
            } else if (paletteChoice < 0.7) {
                colors[idx * 4] = 0.55;                        // Nebula violet
                colors[idx * 4 + 1] = 0.08;
                colors[idx * 4 + 2] = 0.88;
            } else if (paletteChoice < 0.85) {
                colors[idx * 4] = 0.92;                        // Amber/Orange dust
                colors[idx * 4 + 1] = 0.45;
                colors[idx * 4 + 2] = 0.08;
            } else {
                colors[idx * 4] = 0.05;                        // Nebula dark cobalt blue
                colors[idx * 4 + 1] = 0.35;
                colors[idx * 4 + 2] = 0.88;
            }
            
            // Fixed threshold issue: high base alphas (around 0.04 - 0.12) to resist black clamping on basic screens
            colors[idx * 4 + 3] = 0.045 + Math.random() * 0.075; 

            params[idx * 3] = Math.random() * 65.0 + 38.0; // Visible size for layered, voluminous texture
            params[idx * 3 + 1] = 0.22 + Math.random() * 0.06;
            params[idx * 3 + 2] = 1.0;
        }

        // 4. HIGH DENSITY BACKGROUND STARFIELD
        for (let i = 0; i < backgroundStars; i++, idx++) {
            coords[idx * 3] = (Math.random() - 0.5) * 16.0;
            coords[idx * 3 + 1] = (Math.random() - 0.5) * 9.0;
            coords[idx * 3 + 2] = (Math.random() - 0.5) * 2.5;

            colors[idx * 4] = 0.65 + Math.random() * 0.35;
            colors[idx * 4 + 1] = 0.72 + Math.random() * 0.28;
            colors[idx * 4 + 2] = 1.0;
            colors[idx * 4 + 3] = 0.35 + Math.random() * 0.45; // Enhanced visibility for ambient star layers

            params[idx * 3] = Math.random() * 3.0 + 1.1;
            params[idx * 3 + 1] = Math.random() * 6.28;
            params[idx * 3 + 2] = 2.0;
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
        this.time += delta;

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