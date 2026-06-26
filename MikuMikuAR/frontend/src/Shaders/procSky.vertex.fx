precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vPositionW;
void main(void) {
    vec4 wPos = world * vec4(position, 1.0);
    vPositionW = wPos.xyz;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
