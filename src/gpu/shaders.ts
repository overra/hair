// Assemble WGSL modules: raw kernel sources + TypeGPU-resolved resource
// declarations for the bind group layouts they reference.
import tgpu from 'typegpu';
import { bodySdfWgsl } from '../body/sdf';
import { drawLayout, frameLayout, layerLayout, shadowLayout, toolLayout } from './layouts';
import { commonWgsl } from './wgsl/common';
import { groomWgsl } from './wgsl/groom';
import { simWgsl } from './wgsl/sim';
import { expandWgsl } from './wgsl/expand';
import { bodyRenderWgsl, hairRenderWgsl, shadeCommonWgsl } from './wgsl/render';

const resolve = (template: string, externals: Record<string, object>) => tgpu.resolve({ template, externals });

export function buildShaderSources() {
  const sdf = bodySdfWgsl();
  return {
    groom: resolve(commonWgsl + sdf + groomWgsl, { L: layerLayout, F: frameLayout, T: toolLayout }),
    sim: resolve(commonWgsl + sdf + simWgsl, { L: layerLayout, F: frameLayout }),
    expand: resolve(commonWgsl + expandWgsl, { L: layerLayout, F: frameLayout }),
    hair: resolve(commonWgsl + shadeCommonWgsl + hairRenderWgsl, { D: drawLayout, F: frameLayout, Sh: shadowLayout }),
    body: resolve(commonWgsl + shadeCommonWgsl + bodyRenderWgsl, { F: frameLayout, Sh: shadowLayout }),
  };
}
