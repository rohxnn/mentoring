const indexQueries = [
	{
		modelName: 'Session',
		queries: [
			`CREATE INDEX IF NOT EXISTS idx_filtered_sessions ON m_sessions (mentor_organization_id, status, type, mentor_id);`,
		],
	},
	{
		modelName: 'MentorExtension',
		queries: [`CREATE INDEX IF NOT EXISTS idx_m_mentor_extensions_email ON m_mentor_extensions (email);`],
	},
]

module.exports = indexQueries
