'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		// Update existing queries in the report_queries table with Citus-compatible versions

		// Update total_number_of_sessions_attended
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT 
                COUNT(*) AS total_count,
                CASE 
                    WHEN 'All' = 'All' THEN 
                        COUNT(*) FILTER (WHERE Session.type = 'PUBLIC') -- Count for Public sessions
                    ELSE NULL 
                END AS public_count,
                CASE 
                    WHEN 'All' = 'All' THEN 
                        COUNT(*) FILTER (WHERE Session.type = 'PRIVATE') -- Count for Private sessions
                    ELSE NULL 
                END AS private_count
                FROM 
                    public.session_attendees AS sa
                JOIN 
                    public.sessions AS Session
                ON 
                    sa.session_id = Session.id AND Session.tenant_code = sa.tenant_code
                WHERE 
                    Session.tenant_code = :tenantCode 
                    AND (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
                    AND sa.joined_at IS NOT NULL
                    AND (CASE WHEN :start_date IS NOT NULL THEN Session.start_date > :start_date ELSE TRUE END)
                    AND (CASE WHEN :end_date IS NOT NULL THEN Session.end_date < :end_date ELSE TRUE END)
                    AND (
                        CASE 
                            WHEN :session_type = 'All' THEN Session.type IN ('PUBLIC', 'PRIVATE')
                            WHEN :session_type = 'Public' THEN Session.type = 'PUBLIC'
                            WHEN :session_type = 'Private' THEN Session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_number_of_sessions_attended',
			}
		)

		// Update total_hours_of_learning
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                TO_CHAR(
                    INTERVAL '1 hour' * FLOOR(SUM(duration) / 3600) +
                    INTERVAL '1 minute' * FLOOR((SUM(duration) / 60)::BIGINT % 60) +
                    INTERVAL '1 second' * FLOOR(SUM(duration)::BIGINT % 60),
                    'HH24:MI:SS'
                ) AS total_hours,  -- Total duration of all sessions
            
                TO_CHAR(
                    INTERVAL '1 hour' * FLOOR(SUM(CASE WHEN type = 'PUBLIC' THEN duration ELSE 0 END) / 3600) +
                    INTERVAL '1 minute' * FLOOR((SUM(CASE WHEN type = 'PUBLIC' THEN duration ELSE 0 END) / 60)::BIGINT % 60) +
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN type = 'PUBLIC' THEN duration ELSE 0 END)::BIGINT % 60),
                    'HH24:MI:SS'
                ) AS public_hours,  -- Total duration of public sessions
            
                TO_CHAR(
                    INTERVAL '1 hour' * FLOOR(SUM(CASE WHEN type = 'PRIVATE' THEN duration ELSE 0 END) / 3600) +
                    INTERVAL '1 minute' * FLOOR((SUM(CASE WHEN type = 'PRIVATE' THEN duration ELSE 0 END) / 60)::BIGINT % 60) +
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN type = 'PRIVATE' THEN duration ELSE 0 END)::BIGINT % 60),
                    'HH24:MI:SS'
                ) AS private_hours  -- Total duration of private sessions
            
                FROM (
                    SELECT
                        sa.session_id,
                        EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) AS duration,
                        Session.type
                    FROM
                        public.session_attendees AS sa
                    JOIN
                        public.sessions AS Session
                    ON
                        sa.session_id = Session.id AND Session.tenant_code = sa.tenant_code
                    WHERE
                        Session.tenant_code = :tenantCode
                        AND (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
                        AND sa.joined_at IS NOT NULL
                        AND (CASE WHEN :start_date IS NOT NULL THEN Session.start_date > :start_date ELSE TRUE END)
                        AND (CASE WHEN :end_date IS NOT NULL THEN Session.end_date < :end_date ELSE TRUE END)
                        AND (
                            CASE 
                                WHEN :session_type = 'All' THEN Session.type IN ('PUBLIC', 'PRIVATE')
                                WHEN :session_type = 'Public' THEN Session.type = 'PUBLIC'
                                WHEN :session_type = 'Private' THEN Session.type = 'PRIVATE'
                                ELSE TRUE
                            END
                        )
                        AND Session.deleted_at IS NULL
                        DYNAMIC_AND_CLAUSE
                ) AS session_durations`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_learning',
			}
		)

		// Update split_of_sessions_enrolled_and_attended_by_user
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT 
                :start_date AS startDate,
                :end_date AS endDate,
                -- Enrolled session counts
                COUNT(
                    CASE 
                        WHEN (sa.type = 'ENROLLED' OR sa.type = 'INVITED')
                            AND Session.type = 'PUBLIC' 
                            AND (:session_type = 'All' OR :session_type = 'Public') 
                        THEN 1 
                    END
                ) AS public_session_enrolled,

                -- Private session enrolled count
                COUNT(
                    CASE 
                        WHEN (sa.type = 'ENROLLED' OR sa.type = 'INVITED')
                            AND Session.type = 'PRIVATE' 
                            AND (:session_type = 'All' OR :session_type = 'Private') 
                        THEN 1 
                    END
                ) AS private_session_enrolled,

                -- Public session attended count
                COUNT(
                    CASE 
                        WHEN sa.joined_at IS NOT NULL 
                            AND Session.type = 'PUBLIC' 
                            AND (:session_type = 'All' OR :session_type = 'Public') 
                        THEN 1 
                    END
                ) AS public_session_attended,

                -- Private session attended count
                COUNT(
                    CASE 
                        WHEN sa.joined_at IS NOT NULL 
                            AND Session.type = 'PRIVATE' 
                            AND (:session_type = 'All' OR :session_type = 'Private') 
                        THEN 1 
                    END
                ) AS private_session_attended
                FROM public.session_attendees AS sa
                JOIN public.sessions AS Session
                ON sa.session_id = Session.id AND Session.tenant_code = sa.tenant_code
                WHERE 
                    Session.tenant_code = :tenantCode 
                    AND (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
                    AND (CASE WHEN :start_date IS NOT NULL THEN Session.start_date > :start_date ELSE TRUE END)
                    AND (CASE WHEN :end_date IS NOT NULL THEN Session.end_date < :end_date ELSE TRUE END)
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_enrolled_and_attended_by_user',
			}
		)

		// Update mentee_session_details
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                s.title AS "sessions_title",
                ue.name AS "sessions_created_by",
                s.mentor_name AS "mentor_name",
                TO_TIMESTAMP(s.start_date)::DATE AS "date_of_session",
                s.type AS "session_type",
                s.categories AS "categories",
                s.recommended_for AS "recommended_for",
                s.deleted_at,
                CASE WHEN sa.joined_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS "session_attended",
                ROUND(EXTRACT(EPOCH FROM (TO_TIMESTAMP(s.end_date) - TO_TIMESTAMP(s.start_date))) / 60) AS "duration_of_sessions_attended_in_minutes",
                s.tenant_code
                FROM
                    public.sessions s
                LEFT JOIN
                    public.user_extensions ue ON s.created_by = ue.user_id AND s.tenant_code = ue.tenant_code
                JOIN
                    public.session_attendees sa ON sa.session_id = s.id AND sa.tenant_code = s.tenant_code
                WHERE
                    s.tenant_code = :tenantCode
                    AND (:userId IS NULL OR sa.mentee_id = :userId)
                    AND (:start_date IS NULL OR s.start_date > :start_date)
                    AND (:end_date IS NULL OR s.end_date < :end_date)
                    AND (
                        (:session_type = 'All' AND s.type IN ('PUBLIC', 'PRIVATE'))
                        OR (:session_type = 'PUBLIC' AND s.type = 'PUBLIC')
                        OR (:session_type = 'PRIVATE' AND s.type = 'PRIVATE')
                    )
                    AND s.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'mentee_session_details',
			}
		)

		// Update total_number_of_sessions_conducted
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                COUNT(*) AS total_count,
                COUNT(CASE WHEN Session.type = 'PUBLIC' THEN 1 END) AS public_count,
                COUNT(CASE WHEN Session.type = 'PRIVATE' THEN 1 END) AS private_count
                FROM public.sessions AS Session
                WHERE
                    Session.tenant_code = :tenantCode
                    AND Session.mentor_id = :userId
                    AND Session.status = 'COMPLETED'
                    AND Session.start_date > :start_date
                    AND Session.end_date < :end_date
                    AND (
                        CASE
                            WHEN :session_type = 'All' THEN Session.type IN ('PUBLIC', 'PRIVATE')
                            WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                            WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_number_of_sessions_conducted',
			}
		)

		// Update total_hours_of_mentoring_conducted
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT 
                -- Total duration (sum of both public and private sessions)
                COALESCE(
                    TO_CHAR(
                        INTERVAL '1 hour' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type IN ('PUBLIC', 'PRIVATE') 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 3600) +
                        INTERVAL '1 minute' * FLOOR((SUM(
                            CASE 
                                WHEN Session.type IN ('PUBLIC', 'PRIVATE') 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 60)::BIGINT % 60) +
                        INTERVAL '1 second' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type IN ('PUBLIC', 'PRIVATE') 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        )::BIGINT % 60),
                        'HH24:MI:SS'
                    ), 
                    '00:00:00'
                ) AS total_hours,
            
                -- Duration for public sessions
                COALESCE(
                    TO_CHAR(
                        INTERVAL '1 hour' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type = 'PUBLIC' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 3600) +
                        INTERVAL '1 minute' * FLOOR((SUM(
                            CASE 
                                WHEN Session.type = 'PUBLIC' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 60)::BIGINT % 60) +
                        INTERVAL '1 second' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type = 'PUBLIC' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        )::BIGINT % 60),
                        'HH24:MI:SS'
                    ), 
                    '00:00:00'
                ) AS public_hours,
            
                -- Duration for private sessions
                COALESCE(
                    TO_CHAR(
                        INTERVAL '1 hour' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type = 'PRIVATE' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 3600) +
                        INTERVAL '1 minute' * FLOOR((SUM(
                            CASE 
                                WHEN Session.type = 'PRIVATE' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        ) / 60)::BIGINT % 60) +
                        INTERVAL '1 second' * FLOOR(SUM(
                            CASE 
                                WHEN Session.type = 'PRIVATE' 
                                THEN EXTRACT(EPOCH FROM (Session.completed_at - Session.started_at)) 
                                ELSE 0 
                            END
                        )::BIGINT % 60),
                        'HH24:MI:SS'
                    ), 
                    '00:00:00'
                ) AS private_hours
            
                FROM public.sessions Session
                WHERE Session.tenant_code = :tenantCode
                    AND Session.mentor_id = :userId 
                    AND Session.status = 'COMPLETED'
                    AND Session.start_date > :start_date
                    AND Session.end_date < :end_date
                    AND (
                        CASE 
                            WHEN :session_type = 'All' THEN Session.type IN ('PUBLIC', 'PRIVATE')
                            WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                            WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_mentoring_conducted',
			}
		)

		// Update split_of_sessions_conducted
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                :start_date AS startDate,
                :end_date AS endDate,
            
                -- Total sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (session.created_by = :userId OR session.mentor_id = :userId)
                        AND (
                            :session_type = 'All'
                            OR (:session_type = 'Public' AND session.type = 'PUBLIC')
                            OR (:session_type = 'Private' AND session.type = 'PRIVATE')
                        )
                    )
                    THEN session.id
                END) AS total_sessions_created,
            
                -- PUBLIC sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (session.created_by = :userId OR session.mentor_id = :userId)
                        AND session.type = 'PUBLIC'
                        AND (:session_type = 'All' OR :session_type = 'Public')
                    )
                    THEN session.id
                END) AS public_sessions_created,
            
                -- PRIVATE sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (session.created_by = :userId OR session.mentor_id = :userId)
                        AND session.type = 'PRIVATE'
                        AND (:session_type = 'All' OR :session_type = 'Private')
                    )
                    THEN session.id
                END) AS private_sessions_created,
            
                -- Total sessions conducted
                COUNT(DISTINCT CASE
                    WHEN (
                        session.mentor_id = :userId
                        AND session.status = 'COMPLETED'
                        AND (
                            :session_type = 'All'
                            OR (:session_type = 'Public' AND session.type = 'PUBLIC')
                            OR (:session_type = 'Private' AND session.type = 'PRIVATE')
                        )
                    )
                    THEN session.id
                END) AS total_sessions_conducted,
            
                -- PUBLIC sessions conducted
                COUNT(DISTINCT CASE
                    WHEN (
                        session.mentor_id = :userId
                        AND session.status = 'COMPLETED'
                        AND session.type = 'PUBLIC'
                        AND (:session_type = 'All' OR :session_type = 'Public')
                    )
                    THEN session.id
                END) AS public_sessions_conducted,
            
                -- PRIVATE sessions conducted
                COUNT(DISTINCT CASE
                    WHEN (
                        session.mentor_id = :userId
                        AND session.status = 'COMPLETED'
                        AND session.type = 'PRIVATE'
                        AND (:session_type = 'All' OR :session_type = 'Private')
                    )
                    THEN session.id
                END) AS private_sessions_conducted
            
                FROM public.sessions AS session
                WHERE
                    session.tenant_code = :tenantCode
                    AND (session.start_date > :start_date OR :start_date IS NULL)
                    AND (session.end_date < :end_date OR :end_date IS NULL)
                    AND (:userId IS NOT NULL)
                    AND session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_conducted',
			}
		)

		// Update mentoring_session_details
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                session.title AS "sessions_title",
                ue.name AS "sessions_created_by",
                session.seats_limit-session.seats_remaining AS "number_of_mentees",
                TO_TIMESTAMP(session.start_date)::DATE AS "date_of_session",
                session.type AS "session_type",
                CASE WHEN session.started_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS "session_conducted",
                ROUND(EXTRACT(EPOCH FROM(TO_TIMESTAMP(session.end_date)-TO_TIMESTAMP(session.start_date)))/60) AS "duration_of_sessions_attended_in_minutes"
                FROM public.sessions AS session
                LEFT JOIN
                    public.user_extensions AS ue ON session.created_by = ue.user_id AND session.tenant_code = ue.tenant_code
                WHERE
                    session.tenant_code = :tenantCode
                    AND session.mentor_id = :userId
                    AND session.start_date > :start_date 
                    AND session.end_date < :end_date
                    AND (
                        CASE
                            WHEN :session_type = 'All' THEN session.type IN ('PUBLIC', 'PRIVATE')
                            WHEN :session_type = 'PUBLIC' THEN session.type = 'PUBLIC'
                            WHEN :session_type = 'PRIVATE' THEN session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'mentoring_session_details',
			}
		)

		// Update total_hours_of_sessions_created_by_session_manager
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(EXTRACT(EPOCH FROM (completed_at - started_at)))),
                    'HH24:MI:SS'
                ) AS total_hours,
            
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN Session.type = 'PUBLIC' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) ELSE 0 END)),
                    'HH24:MI:SS'
                ) AS total_public_hours,
            
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN Session.type = 'PRIVATE' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) ELSE 0 END)),
                    'HH24:MI:SS'
                ) AS total_private_hours
            
                FROM public.sessions AS Session
                WHERE
                    Session.tenant_code = :tenantCode 
                    AND Session.created_by = :userId 
                    AND Session.status = 'COMPLETED' 
                    AND Session.start_date > :start_date 
                    AND Session.end_date < :end_date
                    AND (
                        CASE 
                            WHEN :session_type = 'All' THEN TRUE
                            WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                            WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_sessions_created_by_session_manager',
			}
		)

		// Update total_number_of_hours_of_mentoring_conducted
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(EXTRACT(EPOCH FROM (completed_at - started_at)))),
                    'HH24:MI:SS'
                ) AS total_hours,
            
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN Session.type = 'PUBLIC' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) ELSE 0 END)),
                    'HH24:MI:SS'
                ) AS public_hours,
            
                TO_CHAR(
                    INTERVAL '1 second' * FLOOR(SUM(CASE WHEN Session.type = 'PRIVATE' THEN EXTRACT(EPOCH FROM (completed_at - started_at)) ELSE 0 END)),
                    'HH24:MI:SS'
                ) AS private_hours
            
                FROM public.sessions AS Session
                WHERE
                    Session.tenant_code = :tenantCode 
                    AND Session.mentor_id = :userId 
                    AND Session.status = 'COMPLETED' 
                    AND Session.start_date > :start_date 
                    AND Session.end_date < :end_date
                    AND (
                        CASE 
                            WHEN :session_type = 'All' THEN TRUE
                            WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                            WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                            ELSE TRUE
                        END
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_number_of_hours_of_mentoring_conducted',
			}
		)

		// Update split_of_sessions_created_and_conducted
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `SELECT
                :start_date AS startDate,
                :end_date AS endDate,
                
                -- Total sessions created
                COUNT(*) FILTER (
                    WHERE (
                        :session_type = 'All'
                        OR (:session_type = 'Public' AND s.type = 'PUBLIC')
                        OR (:session_type = 'Private' AND s.type = 'PRIVATE')
                    )
                    AND (:userId IS NULL OR s.created_by = :userId)
                ) AS total_session_created,
                
                -- Total sessions conducted
                COUNT(*) FILTER (
                    WHERE s.status = 'COMPLETED'
                    AND (
                        :session_type = 'All'
                        OR (:session_type = 'Public' AND s.type = 'PUBLIC')
                        OR (:session_type = 'Private' AND s.type = 'PRIVATE')
                    )
                    AND (:userId IS NULL OR s.mentor_id = :userId)
                ) AS total_sessions_conducted,
                
                -- Public sessions conducted
                COUNT(*) FILTER (
                    WHERE s.status = 'COMPLETED'
                    AND s.type = 'PUBLIC'
                    AND :session_type IN ('All', 'Public')
                    AND (:userId IS NULL OR s.mentor_id = :userId)
                ) AS public_sessions_conducted,
                
                -- Private sessions conducted
                COUNT(*) FILTER (
                    WHERE s.status = 'COMPLETED'
                    AND s.type = 'PRIVATE'
                    AND :session_type IN ('All', 'Private')
                    AND (:userId IS NULL OR s.mentor_id = :userId)
                ) AS private_sessions_conducted,
                
                -- Public sessions created
                COUNT(*) FILTER (
                    WHERE s.type = 'PUBLIC'
                    AND :session_type IN ('All', 'Public')
                    AND (:userId IS NULL OR s.created_by = :userId)
                ) AS public_sessions_created,
                
                -- Private sessions created
                COUNT(*) FILTER (
                    WHERE s.type = 'PRIVATE'
                    AND :session_type IN ('All', 'Private')
                    AND (:userId IS NULL OR s.created_by = :userId)
                ) AS private_sessions_created
            
                FROM public.sessions s
                WHERE
                    s.tenant_code = :tenantCode
                    AND (:start_date IS NULL OR s.start_date > :start_date)
                    AND (:end_date IS NULL OR s.end_date < :end_date)
                    AND (
                        :session_type = 'All'
                        OR :session_type = 'Public'
                        OR :session_type = 'Private'
                    )
                    AND s.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_created_and_conducted',
			}
		)

		// Update session_manger_session_details
		await queryInterface.bulkUpdate(
			'report_queries',
			{
				query: `WITH 
                session_count AS (
                    SELECT 
                        session.tenant_code,
                        session.mentor_id, 
                        session.mentor_name, 
                        COUNT(*) AS number_of_sessions,
                        TO_CHAR( 
                            INTERVAL '1 second' * ROUND(SUM(EXTRACT(EPOCH FROM (session.completed_at - session.started_at)))),
                            'HH24:MI:SS'
                        ) AS "hours_of_mentoring_sessions"
                    FROM public.sessions AS session 
                    WHERE session.tenant_code = :tenantCode
                        AND session.created_by = :userId 
                        AND session.started_at IS NOT NULL 
                        AND session.completed_at IS NOT NULL 
                        AND session.start_date > :start_date 
                        AND session.end_date < :end_date 
                        AND (
                            CASE
                                WHEN :session_type = 'All' THEN session.type IN ('PUBLIC', 'PRIVATE')
                                WHEN :session_type = 'Public' THEN session.type = 'PUBLIC'
                                WHEN :session_type = 'Private' THEN session.type = 'PRIVATE'
                                ELSE TRUE
                            END
                        )
                        AND session.deleted_at IS NULL
                    GROUP BY session.tenant_code, session.mentor_id, session.mentor_name
                )
                SELECT 
                    sc.tenant_code, 
                    sc.mentor_name as mentor_name , 
                    sc.number_of_sessions as number_of_mentoring_sessions,
                    sc.hours_of_mentoring_sessions as hours_of_mentoring_sessions,
                    COALESCE(CAST(ue.rating ->>'average' AS NUMERIC),0) AS avg_mentor_rating
                FROM session_count AS sc
                JOIN public.user_extensions AS ue ON sc.mentor_id = ue.user_id AND sc.tenant_code = ue.tenant_code 
                DYNAMIC_WHERE_CLAUSE
                ORDER BY sc.mentor_name;`,
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'session_manger_session_details',
			}
		)
	},

	async down(queryInterface, Sequelize) {
		// This migration updates existing queries, so rollback would restore original queries
		// Since we don't have the original queries stored, we'll just log a message
		console.log(
			'Rollback: This migration updated existing report queries. Manual restoration of original queries would be required for complete rollback.'
		)
	},
}
