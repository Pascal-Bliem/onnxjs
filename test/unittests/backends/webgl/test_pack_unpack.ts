// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import {expect} from 'chai';

import {Backend, InferenceHandler, SessionHandler} from '../../../../lib/backend';
import {WebGLInferenceHandler} from '../../../../lib/backends/webgl/inference-handler';
import {WebGLPack} from '../../../../lib/backends/webgl/ops/pack';
import {WebGLUnpack} from '../../../../lib/backends/webgl/ops/unpack';
import {Profiler} from '../../../../lib/instrument';
import {Tensor} from '../../../../lib/tensor';
import {ShapeUtil} from '../../../../lib/util';

let backend: Backend|undefined;
let sessionhandler: SessionHandler|undefined;
let inferenceHandler: InferenceHandler|undefined;

function createAscendingArray(size: number): Float32Array {
  return new Float32Array(Array.from({length: size}, (v, i) => (i + 1)));
}

function createTextureFromArray(
    gl: WebGLRenderingContext, dataArray: Float32Array, type: GLenum, width: number, height: number) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, type, width, height, 0, type, gl.UNSIGNED_BYTE, dataArray);
  return texture;
}

function createArrayFromTexture(
    gl: WebGLRenderingContext, texture: WebGLTexture, width: number, height: number): Float32Array {
  const resultDataBuffer = new Float32Array(width * height * 4);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture,
      0);  // 0, we aren't using MIPMAPs
  // TODO: Check if framebuffer is ready
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, resultDataBuffer);
  return resultDataBuffer;
}

describe('#UnitTest# - pack - Tensor pack', () => {
  before('Initialize Context', async () => {
    const profiler = Profiler.create();
    backend = await Backend('webgl');
    sessionhandler = backend.createSessionHandler({profiler});
    inferenceHandler = sessionhandler.createInferenceHandler();
  });
  it('Test pack kernal', () => {
    const op = new WebGLPack();

    const elementCount = 16;
    const inputTensorShape = [4, 4];
    const outputTextureShape = [2, 2];

    // create input data and tensor. The input data will be used to verify if the output tensor contains the same
    // value but possibly different order depending on our packing algorithm.
    const inputData = createAscendingArray(elementCount);
    const inputTensor = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);

    // compile shader code
    const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensor]);
    const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;
    const artifact = webglInferenceHandler.session.programManager.build(programInfo);
    webglInferenceHandler.session.programManager.setArtifact(op, artifact);

    // run kernal and get output
    const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensor]);
    webglInferenceHandler.session.programManager.run(artifact, runData);
    // const result = runData.outputTextureData;
    const resultTexture = runData.outputTextureData.texture;
    const gl = webglInferenceHandler.session.textureManager.glContext.gl;
    const resultDataBuffer = createArrayFromTexture(gl, resultTexture, outputTextureShape[0], outputTextureShape[1])

    // verify result.
    // TODO: add more verifications including output value and order
    // TODO: also different input dimensions for different pack code path
    expect(resultDataBuffer).to.not.equal(null);
    expect(resultDataBuffer).to.have.lengthOf(elementCount);
    // TODO: enable verifications after code integration.
    expect(resultDataBuffer).to.deep.equal(new Int32Array([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]));
  });
  it('Test unpack', () => {
    const op = new WebGLUnpack();

    const elementCount = 16;
    const inputTensorShape = [4, 4];
    const inputTextureShape = [2, 2];
    const outputTensorShape = [4, 4];

    // create input data and tensor. The input data will be used to verify if the output tensor contains the same value
    // but possibly different order depending on our packing algorithm.
    const inputData = createAscendingArray(elementCount);
    const inputTensor = new Tensor(inputTensorShape, 'float32', undefined, undefined, inputData);

    const webglInferenceHandler = inferenceHandler as WebGLInferenceHandler;

    // manually creat packed texture from inputTensor, and insert in cache
    const gl = webglInferenceHandler.session.textureManager.glContext.gl;
    const webglTexture = createTextureFromArray(gl, inputData, gl.RGBA, inputTextureShape[0], inputTextureShape[1]);
    const packedShape = inputTextureShape;
    const textureData = {
      width: inputTextureShape[0],
      height: inputTextureShape[1],
      channels: 4 as const,
      isPacked: true,
      shape: packedShape,
      strides: ShapeUtil.computeStrides(packedShape),
      unpackedShape: outputTensorShape,
      tensor: inputTensor,
      texture: webglTexture!
    };
    webglInferenceHandler.setTextureData(inputTensor.dataId, textureData);

    // compile shader code
    const programInfo = op.createProgramInfo(inferenceHandler! as WebGLInferenceHandler, [inputTensor]);

    const artifact = webglInferenceHandler.session.programManager.build(programInfo);
    webglInferenceHandler.session.programManager.setArtifact(op, artifact);

    // run kernal and get output
    const runData = op.createRunData(webglInferenceHandler, artifact.programInfo, [inputTensor]);
    webglInferenceHandler.session.programManager.run(artifact, runData);
    const result = runData.outputTextureData.tensor.data;

    // verify result.
    expect(result).to.not.equal(null);
    expect(result).to.have.lengthOf(elementCount);
    // TODO: enable verifications after code integration.
    // expect(result).to.deep.equal(new Int32Array([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]));
  });
});