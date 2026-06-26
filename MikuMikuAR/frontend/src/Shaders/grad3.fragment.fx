precision highp float;
uniform vec3 topColor;
uniform vec3 midColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float scale;
varying vec3 vPositionW;
void main(void) {
    float h = vPositionW.y * scale + offset;
    float t;
    vec3 col;
    if (h > 0.5) {
        t = (h - 0.5) * 2.0;
        col = mix(midColor, topColor, t);
    } else {
        t = h * 2.0;
        col = mix(bottomColor, midColor, t);
    }
    gl_FragColor = vec4(col, 1.0);
}
