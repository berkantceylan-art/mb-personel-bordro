-- =====================================================================
-- Web sitesi (mbdentaire.com) — site editörü rolü
-- Yeni enum değeri aynı işlemde kullanılamadığı için ayrı migration.
-- =====================================================================
alter type app_role add value if not exists 'site_editor';
