import { z } from 'zod';
import { blueprintSchema } from '../validators/scenarioSchemas.js';

/**
 * Gemini's OpenAPI 3.0 `responseJsonSchema` implementation supports a strict subset of keywords:
 * type, format, title, description, enum, items, properties, required, nullable.
 * Unions (anyOf, oneOf, allOf) and references ($ref, $defs) are rejected with HTTP 400 INVALID_ARGUMENT.
 * We derive the schema from the Zod blueprint and simplify unions into single objects so the schema
 * is accepted by the Gemini API.
 */
const SUPPORTED = new Set([
  'type', 'format', 'title', 'description', 'enum', 'items', 'properties', 'required', 'nullable',
]);

export function pruneJsonSchema(node) {
  if (Array.isArray(node)) return node.map(pruneJsonSchema);
  if (node === null || typeof node !== 'object') return node;

  // Collapse anyOf (e.g. locationId strings/enums) into a single string type
  if (node.anyOf) {
    return { type: 'string' };
  }

  // Collapse oneOf (e.g. effects discriminated union) into a unified object schema
  if (node.oneOf) {
    const mergedProps = {};
    const types = [];
    for (const opt of node.oneOf) {
      if (opt.properties) {
        for (const [pk, pv] of Object.entries(opt.properties)) {
          if (pk === 'type' && (pv.const || pv.enum)) {
            types.push(pv.const || (pv.enum && pv.enum[0]));
          } else {
            mergedProps[pk] = pruneJsonSchema(pv);
          }
        }
      }
    }
    return {
      type: 'object',
      properties: {
        type: { type: 'string', enum: types },
        ...mergedProps,
      },
      required: ['type'],
    };
  }

  // Collapse allOf into a unified object schema
  if (node.allOf) {
    const mergedProps = {};
    const req = new Set();
    for (const sub of node.allOf) {
      if (sub.properties) {
        Object.assign(mergedProps, sub.properties);
      }
      if (Array.isArray(sub.required)) {
        sub.required.forEach((r) => req.add(r));
      }
    }
    return pruneJsonSchema({
      type: 'object',
      properties: mergedProps,
      ...(req.size ? { required: Array.from(req) } : {}),
    });
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'const') { out.enum = [value]; continue; }
    if (key === 'properties') {
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pruneJsonSchema(v)]));
      continue;
    }
    if (SUPPORTED.has(key)) out[key] = pruneJsonSchema(value);
  }
  return out;
}

export function blueprintGeminiSchema() {
  return pruneJsonSchema(z.toJSONSchema(blueprintSchema, { io: 'output' }));
}

