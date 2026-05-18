//! vac-codegen — generate Rust + TypeScript types from JSON schemas.
//!
//! Deliberately minimal. Handles the exact shapes in `packages/protocol/v1/`:
//! flat objects, enums, arrays, refs, discriminated-union roots (command/event).
//! Not a general-purpose JSON Schema compiler.
//!
//! Usage: `vac-codegen --schemas <dir> --ts-out <dir> --rs-out <dir>`

use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let schemas_dir = arg(&args, "--schemas").unwrap_or("packages/protocol/v1".into());
    let ts_out = arg(&args, "--ts-out").unwrap_or("packages/protocol-ts/src/v1/generated".into());
    let rs_out = arg(&args, "--rs-out").unwrap_or("packages/protocol-rs/src/v1/generated".into());

    eprintln!("[codegen] schemas={schemas_dir} ts-out={ts_out} rs-out={rs_out}");
    let schemas_root = PathBuf::from(&schemas_dir);

    let schema_files = collect_schemas(&schemas_root)?;
    let mut ts_modules = Vec::<(String, String)>::new();
    let mut rs_modules = Vec::<(String, String)>::new();

    for (name, schema) in schema_files {
        let (ts_src, rs_src) = gen_one(&name, &schema)?;
        ts_modules.push((name.clone(), ts_src));
        rs_modules.push((name.clone(), rs_src));
    }

    write_ts(&PathBuf::from(ts_out), &ts_modules)?;
    write_rs(&PathBuf::from(rs_out), &rs_modules)?;
    eprintln!("[codegen] wrote {} modules", ts_modules.len());
    Ok(())
}

fn arg(args: &[String], key: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == key).map(|w| w[1].clone())
}

fn collect_schemas(root: &Path) -> Result<Vec<(String, Value)>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root).with_context(|| format!("read_dir {root:?}"))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let fname = path.file_name().unwrap().to_string_lossy();
        if !fname.ends_with(".schema.json") {
            continue;
        }
        if fname.starts_with("_") {
            continue;
        } // skip _defs
        let name = fname.trim_end_matches(".schema.json").to_string();
        let content: Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
        out.push((name, content));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn gen_one(name: &str, schema: &Value) -> Result<(String, String)> {
    let pascal = to_pascal(name);
    let banner = format!(
        "// @generated — vac-codegen. Do not edit; regenerate via scripts/codegen.sh.\n// Source: packages/protocol/v1/{name}.schema.json\n\n"
    );
    let ts = format!("{banner}{}", ts_for_schema(&pascal, schema));
    let rs = format!("{banner}{}", rs_for_schema(&pascal, schema));
    Ok((ts, rs))
}

// ---------- TypeScript ----------

fn ts_for_schema(name: &str, schema: &Value) -> String {
    let imports = ts_imports_for_schema(name, schema);
    if let Some(enum_vals) = schema.get("enum").and_then(|v| v.as_array()) {
        return format!("{imports}{}", ts_string_literal_union(name, enum_vals));
    }
    // Discriminated union: `type` prop is an enum AND `payload` prop exists.
    if let Some(du) = try_ts_discriminated_union(name, schema) {
        return format!("{imports}{du}");
    }
    let body = match schema.get("type").and_then(|v| v.as_str()) {
        Some("object") => ts_object(name, schema),
        Some("string") => format!("export type {name} = string;\n"),
        _ => ts_object(name, schema),
    };
    format!("{imports}{body}")
}

fn ts_imports_for_schema(current_name: &str, schema: &Value) -> String {
    let mut refs = BTreeSet::new();
    let is_discriminated_union = try_ts_discriminated_union(current_name, schema).is_some();
    if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
        for (key, value) in props {
            if key == "type" || (is_discriminated_union && key == "payload") {
                continue;
            }
            collect_ts_refs(value, &mut refs);
        }
    } else {
        collect_ts_refs(schema, &mut refs);
    }
    refs.remove(current_name);
    if refs.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for name in refs {
        out.push_str(&format!("import type {{ {name} }} from './{name}';\n"));
    }
    out.push('\n');
    out
}

fn collect_ts_refs(value: &Value, refs: &mut BTreeSet<String>) {
    if let Some(r) = value.get("$ref").and_then(|v| v.as_str()) {
        if let Some(name) = ts_ref_import_name(r) {
            refs.insert(name);
        }
        return;
    }
    if value.get("enum").and_then(|v| v.as_array()).is_some() {
        return;
    }
    if matches!(value.get("type").and_then(|v| v.as_str()), Some("array")) {
        if let Some(items) = value.get("items") {
            collect_ts_refs(items, refs);
        }
    }
}

fn ts_ref_import_name(r: &str) -> Option<String> {
    if r.contains("primitives.schema.json#/$defs/") {
        return None;
    }
    let without_fragment = r.split('#').next().unwrap_or(r);
    let file = without_fragment
        .rsplit('/')
        .next()
        .unwrap_or(without_fragment);
    file.strip_suffix(".json").map(|s| s.to_string())
}

/// Emit a TS discriminated union for envelope-style schemas like Command/Event:
/// `{ type: "a"; payload: PayloadFor<"a"> } | { type: "b"; ... }`.
/// Falls back to `None` when the schema isn't envelope-shaped.
fn try_ts_discriminated_union(name: &str, schema: &Value) -> Option<String> {
    let props = schema.get("properties")?.as_object()?;
    let type_prop = props.get("type")?;
    let variants = type_prop.get("enum")?.as_array()?;
    if variants.is_empty() {
        return None;
    }
    props.get("payload")?;
    // Collect common fields other than type/payload.
    let required: Vec<String> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mut other_fields = String::new();
    let mut entries: Vec<(&String, &Value)> = props.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in &entries {
        if k.as_str() == "type" || k.as_str() == "payload" {
            continue;
        }
        let is_req = required.iter().any(|r| &r == k);
        let opt = if is_req { "" } else { "?" };
        let ty = ts_type(v);
        other_fields.push_str(&format!("  {k}{opt}: {ty};\n"));
    }
    let other_indented: String = other_fields
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| format!("      {}\n", l.trim_start()))
        .collect();
    let variants_src: Vec<String> = variants
        .iter()
        .filter_map(|v| v.as_str())
        .map(|t| {
            format!(
                "  | {{\n{other}      type: '{t}';\n      payload: unknown;\n    }}",
                other = other_indented,
            )
        })
        .collect();
    Some(format!(
        "/**\n * Discriminated union over `type`. Narrow with `x.type === '...'`.\n */\nexport type {name} =\n{}\n;\n",
        variants_src.join("\n")
    ))
}

fn ts_string_literal_union(name: &str, vals: &[Value]) -> String {
    let parts: Vec<String> = vals
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| format!("'{s}'"))
        .collect();
    format!("export type {name} =\n  | {};\n", parts.join("\n  | "))
}

fn ts_object(name: &str, schema: &Value) -> String {
    let required: Vec<String> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let props_map = schema.get("properties").and_then(|v| v.as_object());
    let mut body = String::new();
    body.push_str(&format!("export interface {name} {{\n"));
    if let Some(props) = props_map {
        let mut entries: Vec<(&String, &Value)> = props.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (k, v) in entries {
            let is_required = required.iter().any(|r| r == k);
            let ty = ts_type(v);
            let opt = if is_required { "" } else { "?" };
            body.push_str(&format!("  {k}{opt}: {ty};\n"));
        }
    } else {
        body.push_str("  [key: string]: unknown;\n");
    }
    body.push_str("}\n");
    body
}

fn ts_type(v: &Value) -> String {
    if let Some(enm) = v.get("enum").and_then(|x| x.as_array()) {
        return enm
            .iter()
            .filter_map(|e| e.as_str())
            .map(|s| format!("'{s}'"))
            .collect::<Vec<_>>()
            .join(" | ");
    }
    if let Some(r) = v.get("$ref").and_then(|x| x.as_str()) {
        return ts_ref_to_name(r);
    }
    match v.get("type") {
        Some(Value::String(t)) => match t.as_str() {
            "string" => "string".into(),
            "integer" | "number" => "number".into(),
            "boolean" => "boolean".into(),
            "array" => {
                let items = v.get("items");
                let inner = items.map(ts_type).unwrap_or_else(|| "unknown".into());
                format!("{inner}[]")
            }
            "object" => "Record<string, unknown>".into(),
            "null" => "null".into(),
            _ => "unknown".into(),
        },
        Some(Value::Array(types)) => {
            let parts: Vec<String> = types
                .iter()
                .filter_map(|t| t.as_str())
                .map(|s| match s {
                    "string" => "string".into(),
                    "integer" | "number" => "number".into(),
                    "boolean" => "boolean".into(),
                    "null" => "null".into(),
                    _ => "unknown".into(),
                })
                .collect();
            parts.join(" | ")
        }
        _ => "unknown".into(),
    }
}

fn ts_ref_to_name(r: &str) -> String {
    // e.g. "_defs/primitives.schema.json#/$defs/ulid" → "string"
    //       "EvidenceRef.json" → "EvidenceRef"
    if r.contains("primitives.schema.json#/$defs/") {
        let def = r.split('/').next_back().unwrap_or("unknown");
        return match def {
            "ulid" | "iso8601" | "sha256" | "subsystem" | "profile_id_versioned" => "string".into(),
            "severity" => "'ok'|'info'|'warn'|'error'|'critical'|'high'|'medium'|'low'".into(),
            "finding_severity" => "'critical'|'high'|'medium'|'low'|'info'".into(),
            "verdict_status" => "'READY'|'CONDITIONAL'|'BLOCKED'|'PASS'|'WARN'|'FAIL'".into(),
            "lane" => "'transient'|'persistent'|'sticky'".into(),
            "assessment_family" => "'RTD'|'PM'|'UX'|'Frontend'|'Security'|'Reliability'|'Perf'|'Release'|'Launch'|'QA'|'Docs'|'Growth'".into(),
            "confidence" => "number".into(),
            "depth" => "'quick'|'standard'|'full'".into(),
            _ => "string".into(),
        };
    }
    if let Some(name) = r.strip_suffix(".json") {
        return name.to_string();
    }
    "unknown".into()
}

// ---------- Rust ----------

fn rs_for_schema(name: &str, schema: &Value) -> String {
    let mut out = String::new();
    out.push_str("use serde::{Deserialize, Serialize};\n\n");
    if let Some(envelope) = try_rs_typed_envelope(name, schema) {
        out.push_str(&envelope);
        return out;
    }
    if let Some(enum_vals) = schema.get("enum").and_then(|v| v.as_array()) {
        out.push_str(&rs_string_enum(name, enum_vals));
        return out;
    }
    match schema.get("type").and_then(|v| v.as_str()) {
        Some("object") => out.push_str(&rs_struct(name, schema)),
        Some("string") => out.push_str(&format!("pub type {name} = String;\n")),
        _ => out.push_str(&rs_struct(name, schema)),
    }
    out
}

fn rs_string_enum(name: &str, vals: &[Value]) -> String {
    let mut body = String::new();
    body.push_str("#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]\n");
    body.push_str(&format!("pub enum {name} {{\n"));
    for v in vals {
        if let Some(s) = v.as_str() {
            body.push_str(&format!(
                "    #[serde(rename = \"{s}\")]\n    {},\n",
                to_pascal_ident(s)
            ));
        }
    }
    body.push_str("}\n");
    body
}

fn try_rs_typed_envelope(name: &str, schema: &Value) -> Option<String> {
    let props = schema.get("properties")?.as_object()?;
    let type_prop = props.get("type")?;
    let variants = type_prop.get("enum")?.as_array()?;
    if variants.is_empty() || !props.contains_key("payload") || !props.contains_key("v") {
        return None;
    }

    let enum_name = format!("{name}Type");
    let version_name = format!("{name}Version");
    let mut out = String::new();
    out.push_str("#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\n");
    out.push_str(&format!("pub enum {enum_name} {{\n"));
    for value in variants {
        let Some(id) = value.as_str() else { continue };
        out.push_str(&format!(
            "    #[serde(rename = \"{id}\")]\n    {},\n",
            to_pascal_ident(id)
        ));
    }
    out.push_str("}\n\n");

    out.push_str("#[derive(Debug, Clone, Copy, PartialEq, Eq)]\n");
    out.push_str(&format!("pub struct {version_name};\n\n"));
    out.push_str(&format!("impl {version_name} {{\n"));
    out.push_str("    pub const VALUE: i64 = 1;\n");
    out.push_str("}\n\n");
    out.push_str(&format!("impl Serialize for {version_name} {{\n"));
    out.push_str("    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>\n");
    out.push_str("    where\n");
    out.push_str("        S: serde::Serializer,\n");
    out.push_str("    {\n");
    out.push_str("        serializer.serialize_i64(Self::VALUE)\n");
    out.push_str("    }\n");
    out.push_str("}\n\n");
    out.push_str(&format!(
        "impl<'de> Deserialize<'de> for {version_name} {{\n"
    ));
    out.push_str("    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>\n");
    out.push_str("    where\n");
    out.push_str("        D: serde::Deserializer<'de>,\n");
    out.push_str("    {\n");
    out.push_str("        let value = i64::deserialize(deserializer)?;\n");
    out.push_str("        if value == Self::VALUE {\n");
    out.push_str("            Ok(Self)\n");
    out.push_str("        } else {\n");
    out.push_str("            Err(serde::de::Error::custom(format!(\n");
    out.push_str("                \"unsupported protocol version {value}; expected {}\",\n");
    out.push_str("                Self::VALUE\n");
    out.push_str("            )))\n");
    out.push_str("        }\n");
    out.push_str("    }\n");
    out.push_str("}\n\n");

    let required: Vec<String> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mut entries: Vec<(&String, &Value)> = props.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));

    out.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");
    out.push_str(&format!("pub struct {name} {{\n"));
    for (key, value) in entries {
        let is_required = required.iter().any(|r| r == key);
        let field = rs_ident(key);
        let renamed = field != *key;
        let ty = match key.as_str() {
            "type" => enum_name.clone(),
            "v" => version_name.clone(),
            _ => rs_type(value),
        };
        let wrapped = if is_required {
            ty
        } else {
            format!("Option<{ty}>")
        };
        if !is_required {
            out.push_str("    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n");
        }
        if renamed {
            out.push_str(&format!("    #[serde(rename = \"{key}\")]\n"));
        }
        out.push_str(&format!("    pub {field}: {wrapped},\n"));
    }
    out.push_str("}\n");
    Some(out)
}

fn rs_struct(name: &str, schema: &Value) -> String {
    let required: Vec<String> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let props = schema.get("properties").and_then(|v| v.as_object());
    let mut body = String::new();
    body.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");
    body.push_str(&format!("pub struct {name} {{\n"));
    if let Some(props) = props {
        let mut entries: Vec<(&String, &Value)> = props.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (k, v) in entries {
            let is_required = required.iter().any(|r| r == k);
            let ty = rs_type(v);
            let field = rs_ident(k);
            let renamed = field != *k;
            let wrapped = if is_required {
                ty.clone()
            } else {
                format!("Option<{ty}>")
            };
            if !is_required {
                body.push_str("    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n");
            }
            if renamed {
                body.push_str(&format!("    #[serde(rename = \"{k}\")]\n"));
            }
            body.push_str(&format!("    pub {field}: {wrapped},\n"));
        }
    }
    body.push_str("}\n");
    body
}

fn rs_type(v: &Value) -> String {
    if let Some(enm) = v.get("enum").and_then(|x| x.as_array()) {
        // Inline string enums as String (simpler than generating per-field enums).
        if enm.iter().all(|x| x.is_string()) {
            return "String".into();
        }
    }
    if let Some(r) = v.get("$ref").and_then(|x| x.as_str()) {
        return rs_ref_to_type(r);
    }
    match v.get("type") {
        Some(Value::String(t)) => match t.as_str() {
            "string" => "String".into(),
            "integer" => "i64".into(),
            "number" => "f64".into(),
            "boolean" => "bool".into(),
            "array" => {
                let items = v.get("items");
                let inner = items
                    .map(rs_type)
                    .unwrap_or_else(|| "serde_json::Value".into());
                format!("Vec<{inner}>")
            }
            "object" => "serde_json::Value".into(),
            "null" => "serde_json::Value".into(),
            _ => "serde_json::Value".into(),
        },
        _ => "serde_json::Value".into(),
    }
}

fn rs_ref_to_type(r: &str) -> String {
    if r.contains("primitives.schema.json#/$defs/") {
        let def = r.split('/').next_back().unwrap_or("unknown");
        return match def {
            "ulid"
            | "iso8601"
            | "sha256"
            | "subsystem"
            | "profile_id_versioned"
            | "severity"
            | "finding_severity"
            | "verdict_status"
            | "lane"
            | "assessment_family"
            | "depth" => "String".into(),
            "confidence" => "f64".into(),
            _ => "String".into(),
        };
    }
    if let Some(name) = r.strip_suffix(".json") {
        return format!("super::{}::{name}", to_snake(name));
    }
    "serde_json::Value".into()
}

// ---------- writers ----------

fn write_ts(out: &Path, modules: &[(String, String)]) -> Result<()> {
    fs::create_dir_all(out)?;
    // Remove old files not in current set
    clear_generated_dir(out, ".ts")?;
    for (name, src) in modules {
        let pascal = to_pascal(name);
        fs::write(out.join(format!("{pascal}.ts")), src)?;
    }
    // Barrel
    let mut barrel = String::from("// @generated — vac-codegen. Do not edit.\n");
    let mut names: Vec<&String> = modules.iter().map(|(n, _)| n).collect();
    names.sort();
    for name in names {
        let pascal = to_pascal(name);
        barrel.push_str(&format!("export * from './{pascal}';\n"));
    }
    fs::write(out.join("index.ts"), barrel)?;
    Ok(())
}

fn write_rs(out: &Path, modules: &[(String, String)]) -> Result<()> {
    fs::create_dir_all(out)?;
    clear_generated_dir(out, ".rs")?;
    let mut mod_rs = String::from(
        "// @generated — vac-codegen. Do not edit.\n#![allow(clippy::all, dead_code)]\n\n",
    );
    let mut names: Vec<&String> = modules.iter().map(|(n, _)| n).collect();
    names.sort();
    // Emit `pub mod foo;`
    for name in &names {
        let snake = to_snake(name);
        let src = &modules.iter().find(|(n, _)| n == *name).unwrap().1;
        fs::write(out.join(format!("{snake}.rs")), src)?;
        mod_rs.push_str(&format!("pub mod {snake};\n"));
    }
    mod_rs.push('\n');
    // Emit flat re-exports so `v1::EvidenceRef` works alongside `v1::evidence_ref::EvidenceRef`.
    for name in &names {
        let snake = to_snake(name);
        mod_rs.push_str(&format!("pub use {snake}::*;\n"));
    }
    fs::write(out.join("mod.rs"), mod_rs)?;
    Ok(())
}

fn clear_generated_dir(dir: &Path, ext: &str) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let p = entry?.path();
        if p.is_file() {
            if let Some(e) = p.extension() {
                if e == ext.trim_start_matches('.') {
                    fs::remove_file(&p)?;
                }
            }
        }
    }
    Ok(())
}

// ---------- case helpers ----------

fn to_pascal(s: &str) -> String {
    let mut out = String::new();
    let mut upper_next = true;
    for c in s.chars() {
        match c {
            '_' | '-' | '.' => upper_next = true,
            _ if upper_next => {
                out.push(c.to_ascii_uppercase());
                upper_next = false;
            }
            _ => out.push(c),
        }
    }
    // Common digit-starting guard
    if out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

fn to_snake(s: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        match c {
            '-' | '.' => out.push('_'),
            _ if c.is_ascii_uppercase() => {
                if prev_lower {
                    out.push('_');
                }
                out.push(c.to_ascii_lowercase());
                prev_lower = false;
            }
            _ => {
                out.push(c);
                prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
            }
        }
    }
    out
}

fn to_pascal_ident(s: &str) -> String {
    let p = to_pascal(s);
    if p.is_empty() {
        "_".into()
    } else {
        p
    }
}

fn rs_ident(s: &str) -> String {
    const RESERVED: &[&str] = &[
        "type", "ref", "match", "move", "use", "mod", "async", "await", "self", "crate",
    ];
    let snake: String = s
        .chars()
        .map(|c| if c == '-' || c == '.' { '_' } else { c })
        .collect();
    if RESERVED.contains(&snake.as_str()) {
        format!("r#{snake}")
    } else {
        snake
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_pascal_handles_separators() {
        assert_eq!(to_pascal("evidence_ref"), "EvidenceRef");
        assert_eq!(to_pascal("assessment-run"), "AssessmentRun");
        assert_eq!(to_pascal("1badleading"), "_1badleading");
    }

    #[test]
    fn to_snake_handles_pascal() {
        assert_eq!(to_snake("EvidenceRef"), "evidence_ref");
        assert_eq!(to_snake("AssessmentRun"), "assessment_run");
    }

    #[test]
    fn rs_ident_escapes_reserved() {
        assert_eq!(rs_ident("type"), "r#type");
        assert_eq!(rs_ident("match"), "r#match");
        assert_eq!(rs_ident("owner"), "owner");
    }

    #[test]
    fn ts_ref_primitives_map_correctly() {
        assert_eq!(
            ts_ref_to_name("_defs/primitives.schema.json#/$defs/ulid"),
            "string"
        );
        assert_eq!(ts_ref_to_name("EvidenceRef.json"), "EvidenceRef");
    }

    #[test]
    fn rs_type_for_primitives() {
        let v: Value = serde_json::json!({"type": "integer"});
        assert_eq!(rs_type(&v), "i64");
        let v: Value = serde_json::json!({"type": "boolean"});
        assert_eq!(rs_type(&v), "bool");
        let v: Value = serde_json::json!({"type": "array", "items": {"type": "string"}});
        assert_eq!(rs_type(&v), "Vec<String>");
    }

    #[test]
    fn ts_string_literal_union_output() {
        let vals: Vec<Value> = vec![serde_json::json!("a"), serde_json::json!("b")];
        let out = ts_string_literal_union("Foo", &vals);
        assert!(out.contains("'a'"));
        assert!(out.contains("'b'"));
        assert!(out.contains("export type Foo"));
    }

    #[test]
    fn ts_for_schema_adds_type_imports_for_refs() {
        let schema: Value = serde_json::json!({
            "type": "object",
            "properties": {
                "evidence": {
                    "type": "array",
                    "items": { "$ref": "EvidenceRef.json" }
                },
                "verdict": { "$ref": "AssessmentVerdict.json" },
                "id": { "$ref": "_defs/primitives.schema.json#/$defs/ulid" }
            },
            "required": ["evidence", "verdict", "id"]
        });

        let out = ts_for_schema("AssessmentFinding", &schema);
        assert!(out.contains("import type { AssessmentVerdict } from './AssessmentVerdict';"));
        assert!(out.contains("import type { EvidenceRef } from './EvidenceRef';"));
        assert!(!out.contains("ulid"));
    }
}
