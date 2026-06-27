#!/usr/bin/env node
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

const rows = psql([
  "-t", "-A", "-F", "\t",
  "-c",
  `select w.id, a.name, w.graph
   from workflows w
   join apps a on a.id = w.app_id
   where a.name like '%导购工作流%'
   order by a.name, w.created_at desc limit 5`
]).trim().split("\n").filter(Boolean);

for (const line of rows) {
  const [workflowId, appName, graphText] = line.split("\t");
  const graph = JSON.parse(graphText);
  console.log(`\n--- ${appName} ---`);
  
  for (const node of graph.nodes ?? []) {
    if (node.data?.type === "knowledge-retrieval") {
      const config = node.data.multiple_retrieval_config || {};
      console.log(`Node ID: ${node.id}, Title: ${node.data.title}`);
      console.log(`Retrieval Mode: ${node.data.retrieval_mode}`);
      console.log(`Top K: ${config.top_k}`);
      console.log(`Score Threshold: ${config.score_threshold}`);
      console.log(`Rerank Enable: ${config.reranking_enable}`);
      
      // Check dataset IDs associated
      const datasetIds = node.data.dataset_ids || [];
      if (datasetIds.length > 0) {
        console.log(`Datasets: ${datasetIds.join(", ")}`);
      }
    }
  }
}
