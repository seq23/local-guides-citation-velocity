#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { deriveContentAtom, validateContentAtom } = require('./lib/content_atom');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'content', '_staged', 'pages.json'),
  path.join(ROOT, 'content', '_live', 'pages.json')
];
const EFFECTIVE_DATE = '2026-06-19';

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, payload) { fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8'); }

function applyToPayload(payload, file) {
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  let pageAtoms = 0;
  let sectionAtoms = 0;
  const atomIds = new Set();
  const errors = [];

  for (const page of pages) {
    const pageTitle = page.title || page.slug || page.path || 'Decision guide';
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const pageAtomInput = {
      title: pageTitle,
      q: pageTitle,
      answer: page.description || sections.map((section) => section.a || section.answer || '').find(Boolean) || '',
      checklist: sections.flatMap((section) => Array.isArray(section.checklist) ? section.checklist : []).slice(0, 8),
      red_flags: sections.flatMap((section) => Array.isArray(section.red_flags) ? section.red_flags : []).slice(0, 6),
      citation_velocity_artifacts: page.citation_velocity_artifacts || []
    };
    page.content_atom = deriveContentAtom(pageAtomInput, { sourceRoute: page.slug || page.path || '/', title: pageTitle });
    page.date_modified = page.date_modified || EFFECTIVE_DATE;
    const pageErrors = validateContentAtom(page.content_atom, { title: pageTitle });
    if (pageErrors.length) errors.push(`${file}:${page.slug || page.path}: ${pageErrors.join(',')}`);
    if (atomIds.has(page.content_atom.atom_id)) errors.push(`${file}:${page.slug || page.path}: duplicate atom id ${page.content_atom.atom_id}`);
    atomIds.add(page.content_atom.atom_id);
    pageAtoms += 1;

    for (const [index, section] of (page.sections || []).entries()) {
      const sectionTitle = section.visible_q || section.q || section.title || `${pageTitle} section ${index + 1}`;
      section.content_atom = deriveContentAtom(section, { sourceRoute: `${page.slug || page.path || '/'}#section-${index + 1}`, title: sectionTitle });
      section.date_modified = section.date_modified || EFFECTIVE_DATE;
      const sectionErrors = validateContentAtom(section.content_atom, { title: sectionTitle });
      if (sectionErrors.length) errors.push(`${file}:${page.slug || page.path}#${index + 1}: ${sectionErrors.join(',')}`);
      if (atomIds.has(section.content_atom.atom_id)) errors.push(`${file}:${page.slug || page.path}#${index + 1}: duplicate atom id ${section.content_atom.atom_id}`);
      atomIds.add(section.content_atom.atom_id);
      sectionAtoms += 1;
    }
  }

  if (errors.length) throw new Error(`Content atom migration failed:\n${errors.slice(0, 50).join('\n')}`);
  payload.programmatic_content_gate = {
    standard: 'data/content/programmatic_content_standard.json',
    effective_date: EFFECTIVE_DATE,
    status: 'ENFORCED',
    page_atoms: pageAtoms,
    section_atoms: sectionAtoms
  };
  return { pageAtoms, sectionAtoms };
}

let totalPages = 0;
let totalSections = 0;
for (const file of TARGETS) {
  const payload = readJson(file);
  const counts = applyToPayload(payload, path.relative(ROOT, file));
  writeJson(file, payload);
  totalPages += counts.pageAtoms;
  totalSections += counts.sectionAtoms;
}
console.log(`Programmatic content atom migration complete: ${totalPages} page atoms and ${totalSections} section atoms across staged/live source layers.`);
