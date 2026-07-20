package com.wails.app;

import android.opengl.GLES11Ext;
import android.opengl.GLES20;

import com.google.ar.core.Frame;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * ARCore 相机帧背景渲染器。
 * 将 ARCore 提供的相机纹理（OES external texture）绘制为全屏四边形。
 * 基于 Google ARCore Android Samples 的 BackgroundRenderer 简化版。
 */
public class BackgroundRenderer {
    private static final String TAG = "BackgroundRenderer";

    // 顶点着色器：处理 OES 外部纹理坐标变换
    private static final String VERTEX_SHADER =
            "attribute vec4 a_Position;\n" +
            "attribute vec2 a_TexCoord;\n" +
            "varying vec2 v_TexCoord;\n" +
            "void main() {\n" +
            "    gl_Position = a_Position;\n" +
            "    v_TexCoord = a_TexCoord;\n" +
            "}\n";

    // 片段着色器：采样 OES 外部纹理
    private static final String FRAGMENT_SHADER =
            "#extension GL_OES_EGL_image_external : require\n" +
            "precision mediump float;\n" +
            "varying vec2 v_TexCoord;\n" +
            "uniform samplerExternalOES u_Texture;\n" +
            "void main() {\n" +
            "    gl_FragColor = texture2D(u_Texture, v_TexCoord);\n" +
            "}\n";

    // 全屏四边形顶点（NDC 坐标）
    private static final float[] QUAD_VERTICES = {
            -1f, -1f,  // 左下
            -1f,  1f,  // 左上
             1f, -1f,  // 右下
             1f,  1f,  // 右上
    };

    // 纹理坐标（ARCore 会通过 transformCoordinates2d 变换）
    private static final float[] QUAD_TEXCOORDS = {
            0f, 1f,
            0f, 0f,
            1f, 1f,
            1f, 0f,
    };

    private FloatBuffer vertexBuffer;
    private FloatBuffer texCoordBuffer;

    private int program;
    private int positionAttrib;
    private int texCoordAttrib;
    private int textureUniform;

    private int textureId;
    private boolean initialized = false;

    // ARCore 变换后的纹理坐标（每帧更新）
    private final float[] transformedTexCoords = new float[8];

    public BackgroundRenderer() {
        // 初始化顶点缓冲
        ByteBuffer bb = ByteBuffer.allocateDirect(QUAD_VERTICES.length * 4);
        bb.order(ByteOrder.nativeOrder());
        vertexBuffer = bb.asFloatBuffer();
        vertexBuffer.put(QUAD_VERTICES);
        vertexBuffer.position(0);

        ByteBuffer tb = ByteBuffer.allocateDirect(QUAD_TEXCOORDS.length * 4);
        tb.order(ByteOrder.nativeOrder());
        texCoordBuffer = tb.asFloatBuffer();
        texCoordBuffer.put(QUAD_TEXCOORDS);
        texCoordBuffer.position(0);
    }

    /**
     * 在 GL 线程上调用，创建着色器程序和纹理。
     */
    public void createOnGlThread() {
        if (initialized) return;

        // 创建 OES 外部纹理（ARCore 相机帧目标）
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        textureId = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
                GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);

        // 编译着色器
        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);

        program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);

        int[] linkStatus = new int[1];
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0);
        if (linkStatus[0] != GLES20.GL_TRUE) {
            String log = GLES20.glGetProgramInfoLog(program);
            throw new RuntimeException("Shader link failed: " + log);
        }

        positionAttrib = GLES20.glGetAttribLocation(program, "a_Position");
        texCoordAttrib = GLES20.glGetAttribLocation(program, "a_TexCoord");
        textureUniform = GLES20.glGetUniformLocation(program, "u_Texture");

        initialized = true;
        android.util.Log.i(TAG, "BackgroundRenderer initialized, textureId=" + textureId);
    }

    /**
     * 获取 ARCore 相机纹理 ID（传给 Session.setCameraTextureName）。
     */
    public int getTextureId() {
        return textureId;
    }

    /**
     * 绘制当前帧的相机背景。
     */
    public void draw(Frame frame) {
        if (!initialized) return;

        // 获取 ARCore 变换后的纹理坐标（处理屏幕旋转等）
        frame.transformCoordinates2d(
                com.google.ar.core.Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,
                vertexBuffer,
                com.google.ar.core.Coordinates2d.TEXTURE_NORMALIZED,
                texCoordBuffer);

        // 绘制全屏四边形
        GLES20.glUseProgram(program);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glUniform1i(textureUniform, 0);

        GLES20.glEnableVertexAttribArray(positionAttrib);
        GLES20.glVertexAttribPointer(positionAttrib, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer);

        GLES20.glEnableVertexAttribArray(texCoordAttrib);
        GLES20.glVertexAttribPointer(texCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer);

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);

        GLES20.glDisableVertexAttribArray(positionAttrib);
        GLES20.glDisableVertexAttribArray(texCoordAttrib);
        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }

    private int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);

        int[] compileStatus = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compileStatus, 0);
        if (compileStatus[0] != GLES20.GL_TRUE) {
            String log = GLES20.glGetShaderInfoLog(shader);
            throw new RuntimeException("Shader compile failed: " + log);
        }
        return shader;
    }
}
