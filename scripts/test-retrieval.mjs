import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, ".");
const psql = (args, input = "") => {
  const result = spawnSync(
    "docker",
    ["exec", "-i", "docker-db_postgres-1", "psql", "-U", "postgres", "-d", "dify", ...args],
    { input, encoding: "utf8", maxBuffer: 100_000_000 }
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};

const searchSQL = `
  select ds.content, dkm.keywords 
  from document_segments ds
  join datasets d on d.id = ds.dataset_id
  left join dataset_keyword_tables dkt on dkt.document_segment_id = ds.id
  left join dataset_keywords dkm on dkm.id = dkt.keyword_id
  where d.id = '482854e9-e85f-4315-aa6e-e0b23e51b619'
  and (ds.content like '%续航%' or ds.content like '%跑多远%' or dkm.keywords like '%续航%' or dkm.keywords like '%跑多远%')
  limit 5;
`;

console.log("Searching for '续航' (Range/Endurance) in economy mode dataset...");
const result = psql(["-t", "-A", "-F", "\t", "-c", searchSQL]).trim();

if (result) {
  const lines = result.split("\n");
  console.log(`Found ${lines.length} segments/keywords containing '续航'.`);
  lines.forEach((line, idx) => {
    const [content, keywords] = line.split("\t");
    console.log(`\n[${idx+1}] Content: ${content?.slice(0, 100)}...`);
    console.log(`    Keywords: ${keywords}`);
  });
} else {
  console.log("No results found. Economy mode failed to retrieve '续航'.");
}

// Also check if any segments have keywords at all
const countSQL = `
  select count(*) 
  from document_segments ds
  join datasets d on d.id = ds.dataset_id
  left join dataset_keyword_tables dkt on dkt.document_segment_id = ds.id
  left join dataset_keywords dkm on dkm.id = dkt.keyword_id
  where d.id = '482854e9-e85f-4315-aa6e-e0b23e51b619';
`;
const totalCount = psql(["-t", "-A", "-F", "\t", "-c", countSQL]).trim();
console.log(`\nTotal segments in Common KB: ${totalCount}`);
