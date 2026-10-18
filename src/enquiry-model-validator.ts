// MIT. Captured finite validation runtime; source/provenance: docs/enquiry-model-provenance.json.
export type FieldKind =
  | "string"
  | "text"
  | "url"
  | "date"
  | "integer"
  | "boolean"
  | "select"
  | "repeater";
export interface ContentField {
  key: string;
  label: string;
  type: FieldKind;
  required: boolean;
  defaultValue?: string | number | boolean;
  validation?: { min?: number; max?: number; maxLength?: number };
  group?: string;
  choices?: string[];
  limit?: number;
  fields?: ContentField[];
  when?: { field: string; equals: string | boolean };
}
export interface ContentModel {
  schema: "app-composer.content-model";
  version: 1;
  collection: string;
  label: string;
  groups: string[];
  fields: ContentField[];
}

// Portable content/form structure, separate from app source/configuration and readiness.
import { isCalendarDate } from "./enquiry-calendar.ts";
export const modelVersion = 1 as const;
export const maxModelBytes = 65536;
export const fieldTypes = Object.freeze({
  string: "Short text",
  text: "Long text",
  url: "HTTPS link",
  date: "Calendar date",
  integer: "Whole number",
  boolean: "Yes / no",
  select: "Choice",
  repeater: "Repeating group",
});
// Pinned to reviewed EmDash 1.2.0 schema/types.ts reserved guards, plus JS safety names.
const reservedFields = new Set([
  "primary_byline_id",
  "scheduled_at",
  "deleted_at",
  "version",
  "live_revision_id",
  "draft_revision_id",
  "terms",
  "bylines",
  "byline",
]);
const reservedCollections = new Set([
  "content",
  "media",
  "users",
  "revisions",
  "taxonomies",
  "options",
  "audit_logs",
  "reorder",
  "relations",
]);
const reserved = new Set([
  "id",
  "slug",
  "status",
  "locale",
  "translation_group",
  "created_at",
  "updated_at",
  "published_at",
  "author_id",
  "owner_id",
  "collection",
  "data",
  "__proto__",
  "prototype",
  "constructor",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fieldKind = (value: unknown): value is FieldKind =>
  typeof value === "string" && Object.hasOwn(fieldTypes, value);
function keys(
  input: unknown,
  allowed: string[],
  label: string,
): asserts input is Record<string, unknown> {
  if (
    !record(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw Error(
      "Unsupported " +
        label +
        " properties. Import the current content model format.",
    );
}
function text(value: unknown, max: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value) ||
    !value.trim()
  )
    throw Error(label + " must be plain text, up to " + max + " characters.");
  return value.trim();
}
function slug(value: unknown, label: string, collection = false): string {
  const clean = text(value, 48, label);
  if (
    !(collection ? /^[a-z][a-z0-9-]*$/ : /^[a-z][a-z0-9_]*$/).test(clean) ||
    reserved.has(clean) ||
    (collection ? reservedCollections : reservedFields).has(clean) ||
    clean.startsWith("_emdash")
  )
    throw Error(
      label +
        " needs a unique lowercase name and cannot use a reserved CMS name.",
    );
  return clean;
}
function scalarValue(
  field: ContentField,
  input: unknown,
): string | number | boolean {
  if (field.type === "date") {
    if (!isCalendarDate(input))
      throw Error(
        field.label +
          " needs a calendar date in YYYY-MM-DD form (years 0001–9999).",
      );
    return input;
  }
  if (field.type === "boolean") {
    if (typeof input !== "boolean")
      throw Error(field.label + " must be Yes / no.");
    return input;
  }
  if (field.type === "integer") {
    const min = field.validation?.min ?? -1000000,
      max = field.validation?.max ?? 1000000;
    if (
      typeof input !== "number" ||
      !Number.isSafeInteger(input) ||
      input < min ||
      input > max
    )
      throw Error(
        field.label +
          " must be a whole number between " +
          min +
          " and " +
          max +
          ".",
      );
    return input;
  }
  if (
    typeof input !== "string" ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)
  )
    throw Error(field.label + " has an unsupported value.");
  const maxLength =
    field.validation?.maxLength ?? (field.type === "text" ? 2000 : 240);
  if (input.length > maxLength)
    throw Error(
      field.label + " must use at most " + maxLength + " characters.",
    );
  if (field.type === "select" && !field.choices?.includes(input))
    throw Error("Choose an option for " + field.label + ".");
  if (field.type === "url") {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw Error(field.label + " needs an HTTPS address.");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error(field.label + " needs an HTTPS address without credentials.");
    return url.href;
  }
  return input;
}
function fields(input: unknown, groups: string[], sub = false): ContentField[] {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > (sub ? 6 : 12)
  )
    throw Error(
      sub ? "Use 1–6 fields in a repeating group." : "Use 1–12 fields.",
    );
  const seen = new Set<string>(),
    processed: ContentField[] = [];
  return (input as unknown[]).map((value) => {
    keys(
      value,
      [
        "key",
        "label",
        "type",
        "required",
        "group",
        "choices",
        "limit",
        "fields",
        "when",
        "defaultValue",
        "validation",
      ],
      "field",
    );
    const key = slug(value.key, "Field key");
    if (seen.has(key)) throw Error("Field keys must be unique in their group.");
    seen.add(key);
    if (!fieldKind(value.type) || (sub && value.type === "repeater"))
      throw Error(
        "Choose a supported field type. EmDash repeaters cannot be nested.",
      );
    if (sub && value.type === "date")
      throw Error(
        "Calendar dates are supported on top-level fields only; native repeating rows cannot enforce their date rule.",
      );
    if (typeof value.required !== "boolean")
      throw Error("Choose whether this field is required.");
    const clean: ContentField = {
      key,
      label: text(value.label, 80, "Field label"),
      type: value.type,
      required: value.required,
    };
    if (!sub) {
      if (typeof value.group !== "string" || !groups.includes(value.group))
        throw Error("Choose an existing field group.");
      clean.group = value.group;
    } else if (value.group !== undefined || value.when !== undefined)
      throw Error("Repeater sub-fields do not have groups or conditions.");
    if (value.type === "select") {
      if (
        !Array.isArray(value.choices) ||
        value.choices.length < 2 ||
        value.choices.length > 8
      )
        throw Error("A choice field needs 2–8 distinct choices.");
      clean.choices = value.choices.map((choice) => text(choice, 60, "Choice"));
      if (new Set(clean.choices).size !== clean.choices.length)
        throw Error("Choice labels must be distinct.");
    } else if (value.choices !== undefined)
      throw Error("Only choice fields have choices.");
    if (value.type === "repeater") {
      if (
        typeof value.limit !== "number" ||
        !Number.isInteger(value.limit) ||
        value.limit < 1 ||
        value.limit > 12
      )
        throw Error("A repeating group supports 1–12 rows.");
      clean.limit = value.limit;
      clean.fields = fields(value.fields, groups, true);
    } else if (value.fields !== undefined || value.limit !== undefined)
      throw Error("Only repeating groups have row limits and sub-fields.");
    if (Object.hasOwn(value, "validation")) {
      if (sub || !["string", "text", "integer"].includes(value.type))
        throw Error(
          "Custom limits are supported on top-level text and whole-number fields only.",
        );
      keys(
        value.validation,
        value.type === "integer" ? ["min", "max"] : ["maxLength"],
        "field limit",
      );
      if (!Object.keys(value.validation).length)
        throw Error("Set a field limit or turn the limits off.");
      const limits: NonNullable<ContentField["validation"]> = {};
      for (const [name, limit] of Object.entries(value.validation)) {
        const low = name === "maxLength" ? 1 : -1000000,
          high =
            name === "maxLength"
              ? value.type === "text"
                ? 2000
                : 240
              : 1000000;
        if (
          typeof limit !== "number" ||
          !Number.isSafeInteger(limit) ||
          limit < low ||
          limit > high
        )
          throw Error(
            "Use a whole-number " +
              name +
              " between " +
              low +
              " and " +
              high +
              ".",
          );
        if (name === "min" || name === "max" || name === "maxLength")
          limits[name] = limit;
      }
      if (
        value.type === "integer" &&
        (limits.min ?? -1000000) > (limits.max ?? 1000000)
      )
        throw Error("The smallest number cannot exceed the largest number.");
      clean.validation = limits;
    }
    if (Object.hasOwn(value, "defaultValue")) {
      if (sub || value.type === "repeater")
        throw Error(
          "Starting values are supported on top-level scalar fields only.",
        );
      if (typeof value.defaultValue === "string" && !value.defaultValue.trim())
        throw Error(
          "Starting value for " +
            clean.label +
            " cannot be empty. Enter a value or turn the default off.",
        );
      clean.defaultValue = scalarValue(clean, value.defaultValue);
    }
    if (value.when !== undefined) {
      keys(value.when, ["field", "equals"], "condition");
      const condition = value.when;
      const controller = processed.find(
        (field) => field.key === condition.field,
      );
      if (
        !controller ||
        controller.when ||
        !["boolean", "select"].includes(controller.type)
      )
        throw Error(
          "A condition must use an earlier, always-visible Yes / no or Choice field.",
        );
      if (value.required)
        throw Error(
          "Conditional fields are optional in this first model. Required conditional validation needs a reviewed server implementation.",
        );
      const equals =
        controller.type === "boolean"
          ? condition.equals
          : text(condition.equals, 60, "Condition choice");
      if (
        controller.type === "boolean"
          ? typeof equals !== "boolean"
          : !(
              typeof equals === "string" && controller.choices?.includes(equals)
            )
      )
        throw Error("Choose an actual value from the condition field.");
      if (typeof equals !== "string" && typeof equals !== "boolean")
        throw Error("Choose a valid condition value.");
      clean.when = { field: controller.key, equals };
    }
    processed.push(clean);
    return clean;
  });
}
export function validateContentModel(input: unknown): ContentModel {
  keys(
    input,
    ["schema", "version", "collection", "label", "groups", "fields"],
    "content model",
  );
  if (input.schema !== "app-composer.content-model" || input.version !== 1)
    throw Error(
      "Use content model version 1. Older or incompatible input is preserved.",
    );
  if (
    !Array.isArray(input.groups) ||
    input.groups.length < 1 ||
    input.groups.length > 4
  )
    throw Error("Use 1–4 field groups.");
  const groups = input.groups.map((group) => text(group, 48, "Group name"));
  if (new Set(groups).size !== groups.length)
    throw Error("Group names must be distinct.");
  const clean: ContentModel = {
    schema: input.schema,
    version: 1,
    collection: slug(input.collection, "Collection name", true),
    label: text(input.label, 80, "Collection label"),
    groups,
    fields: fields(input.fields, groups),
  };
  if (
    new TextEncoder().encode(JSON.stringify(clean, null, 2)).length >
    maxModelBytes
  )
    throw Error(
      "Keep the exported model under 64 KiB. Reduce field labels or choices before saving.",
    );
  return clean;
}
export function visibleModelFields(
  input: unknown,
  values: Record<string, unknown>,
): ContentField[] {
  const model = validateContentModel(input);
  if (!record(values)) throw Error("Use form values as an object.");
  return model.fields.filter((field) => {
    if (!field.when) return true;
    const controller = model.fields.find(
        (item) => item.key === field.when!.field,
      ),
      raw = values[field.when.field];
    const selected =
      controller?.type === "boolean" &&
      (raw === undefined || raw === null || raw === "")
        ? false
        : raw;
    return selected === field.when.equals;
  });
}
export function validateModelValues(
  input: unknown,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const model = validateContentModel(input);
  if (
    !record(values) ||
    Object.keys(values).some(
      (key) => !model.fields.some((field) => field.key === key),
    )
  )
    throw Error("Values contain an unknown field.");
  function value(field: ContentField, input: unknown): unknown {
    if (input === undefined && Object.hasOwn(field, "defaultValue"))
      input = field.defaultValue;
    if (
      input === undefined ||
      input === "" ||
      input === null ||
      (typeof input === "string" && !input.trim())
    ) {
      if (field.required) throw Error(field.label + " is required.");
      return field.type === "boolean"
        ? false
        : field.type === "repeater"
          ? []
          : null;
    }
    if (field.type === "repeater") {
      if (
        !Array.isArray(input) ||
        input.length > field.limit! ||
        (field.required && !input.length)
      )
        throw Error(field.label + " has an invalid row count.");
      return input.map((row) => {
        if (
          !record(row) ||
          Object.keys(row).some(
            (key) => !field.fields!.some((sub) => sub.key === key),
          )
        )
          throw Error("Repeating rows contain an unknown field.");
        return Object.fromEntries(
          field.fields!.map((sub) => [sub.key, value(sub, row[sub.key])]),
        );
      });
    }
    return scalarValue(field, input);
  }
  const normalised = { ...values };
  for (const controller of model.fields.filter(
    (field) => !field.when && ["boolean", "select"].includes(field.type),
  ))
    normalised[controller.key] = value(controller, values[controller.key]);
  return Object.fromEntries(
    visibleModelFields(model, normalised).map((field) => [
      field.key,
      value(field, normalised[field.key]),
    ]),
  );
}
