-- Controlled queued run to test the pre-completion scoring guard without timing races.
INSERT OR IGNORE INTO runs(id,request_hash,config_json,sample_ids_json,status,created_at) VALUES('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','integration-fixture','{}','[]','queued','2026-10-23T00:00:00Z');
