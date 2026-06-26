precision highp float;
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float horizonHeight;
uniform float blendWidth;
varying vec3 vPositionW;
void main(void) {
    float h = (vPositionW.y / 500.0) * 0.5 + 0.5;
    float t = smoothstep(0.0, 1.0, (h - horizonHeight) / blendWidth + 0.5);
    gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
}
