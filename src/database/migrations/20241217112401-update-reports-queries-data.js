'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const defaultOrgId = queryInterface.sequelize.options.defaultOrgId

		if (!defaultOrgId) {
			throw new Error('Default org ID is undefined. Please make sure it is set in sequelize options.')
		}
		// Insert data into the report_queries table
		await queryInterface.bulkInsert('report_queries', [
			{
				report_code: 'total_number_of_sessions_attended',
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
                sa.session_id = Session.id
            WHERE 
                (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
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
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_learning',
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
                    sa.session_id = Session.id
                WHERE
                    (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
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
            ) AS session_durations
            `,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_enrolled_and_attended_by_user',
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
            ON sa.session_id = Session.id
            WHERE 
            (CASE WHEN :userId IS NOT NULL THEN sa.mentee_id = :userId ELSE TRUE END)
            AND (CASE WHEN :start_date IS NOT NULL THEN Session.start_date > :start_date ELSE TRUE END)
            AND (CASE WHEN :end_date IS NOT NULL THEN Session.end_date < :end_date ELSE TRUE END)
            AND Session.deleted_at IS NULL
            DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'mentee_session_details',
				query: `WITH Session AS (
                    SELECT
                        id,
                        title,
                        created_by,
                        mentor_name,
                        start_date,
                        end_date,
                        type,
                        categories,
                        recommended_for,
                        deleted_at
                    FROM
                        public.sessions
                ),
                UserExtensions AS (
                    SELECT
                        user_id,
                        name
                    FROM
                        public.user_extensions
                ),
                SessionAttendees AS (
                    SELECT
                        session_id,
                        mentee_id,
                        joined_at,
                        created_at
                    FROM
                        public.session_attendees
                )
                SELECT
                    Session.title AS "sessions_title",
                    ue.name AS "sessions_created_by",
                    Session.mentor_name AS "mentor_name",
                    TO_TIMESTAMP(Session.start_date)::DATE AS "date_of_session",
                    Session.type AS "session_type",
                    Session.categories AS "categories",
                    Session.recommended_for AS "recommended_for",
                    CASE WHEN sa.joined_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS "session_attended",
                    ROUND(EXTRACT(EPOCH FROM (TO_TIMESTAMP(Session.end_date)-TO_TIMESTAMP(Session.start_date)))/60) AS "duration_of_sessions_attended_in_minutes",
                    sa.created_at
                FROM
                    Session
                LEFT JOIN
                    UserExtensions AS ue ON Session.created_by = ue.user_id
                JOIN
                    SessionAttendees AS sa ON sa.session_id = Session.id
                WHERE
                    (:userId IS NULL OR sa.mentee_id = :userId)
                    AND (:start_date IS NULL OR Session.start_date > :start_date)
                    AND (:end_date IS NULL OR Session.end_date < :end_date)
                    AND (
                        :session_type = 'All' AND Session.type IN ('PUBLIC', 'PRIVATE')
                        OR :session_type = 'PUBLIC' AND Session.type = 'PUBLIC'
                        OR :session_type = 'PRIVATE' AND Session.type = 'PRIVATE'
                    )
                    AND Session.deleted_at IS NULL
                    DYNAMIC_AND_CLAUSE; order by Session.start_date ASC`,

				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_number_of_sessions_conducted',
				query: `SELECT
                COUNT(*) AS total_count,
                COUNT(CASE WHEN Session.type = 'PUBLIC' AND ('All' = 'All' OR 'All' = 'PUBLIC') THEN 1 END) AS public_count,
                COUNT(CASE WHEN Session.type = 'PRIVATE' AND ('All' = 'All' OR 'All' = 'PRIVATE') THEN 1 END) AS private_count
            FROM (
                SELECT
                    *
                FROM
                    public.sessions AS Session
                WHERE
                    Session.started_at IS NOT NULL
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
            ) AS Session
            JOIN
                public.session_ownerships AS so ON so.session_id = Session.id
            WHERE
                so.user_id = :userId
                AND ('MENTOR' IS NULL OR so.type = 'MENTOR')
                AND Session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_mentoring_conducted',
				query: `WITH filtered_ownerships AS (
                    SELECT so.session_id
                    FROM public.session_ownerships so
                    WHERE 
                    so.user_id = :userId 
                    AND so.type = 'MENTOR'
                )
                
                SELECT 
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
                
                FROM filtered_ownerships fo
                JOIN public.sessions Session ON Session.id = fo.session_id  -- Renamed alias from session to Session
                WHERE Session.started_at IS NOT NULL
                AND Session.start_date > :start_date  -- Start date filter
                AND Session.end_date < :end_date    -- End date filter
                AND (
                                        CASE 
                                            WHEN :session_type = 'All' THEN Session.type IN ('PUBLIC', 'PRIVATE')  -- If all types, include both
                                            WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'  -- If PUBLIC, only include public
                                            WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'  -- If PRIVATE, only include private
                                            ELSE TRUE  -- Default condition
                                        END
                                    )
                AND Session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_conducted',
				query: `SELECT
                :start_date AS startDate,
                :end_date AS endDate,
            
                -- Total sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (so.type = 'CREATOR' OR so.type = 'MENTOR')
                        AND (
                            :session_type = 'All'
                            OR (:session_type = 'Public' AND session.type = 'PUBLIC')
                            OR (:session_type = 'Private' AND session.type = 'PRIVATE')
                        )
                        AND (
                            (session.created_by!= :userId AND session.mentor_id = :userId)
                            OR (session.created_by = :userId AND session.mentor_id = :userId)
                        )
                    )
                    THEN session.id
                END) AS total_sessions_created,
            
                -- PUBLIC sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (so.type = 'CREATOR' OR so.type = 'MENTOR')
                        AND session.type = 'PUBLIC'
                        AND (:session_type = 'All' OR :session_type = 'Public')
                        AND (
                            (session.created_by!= :userId AND session.mentor_id = :userId)
                            OR (session.created_by = :userId AND session.mentor_id = :userId)
                        )
                    )
                    THEN session.id
                END) AS public_sessions_created,
            
                -- PRIVATE sessions created
                COUNT(DISTINCT CASE
                    WHEN (
                        (so.type = 'CREATOR' OR so.type = 'MENTOR')
                        AND session.type = 'PRIVATE'
                        AND (:session_type = 'All' OR :session_type = 'Private')
                        AND (
                            (session.created_by!= :userId AND session.mentor_id = :userId)
                            OR (session.created_by = :userId AND session.mentor_id = :userId)
                        )
                    )
                    THEN session.id
                END) AS private_sessions_created,
            
                -- Total sessions conducted
                COUNT(DISTINCT CASE
                    WHEN (
                        so.type = 'MENTOR'
                        AND session.started_at IS NOT NULL
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
                        so.type = 'MENTOR'
                        AND session.started_at IS NOT NULL
                        AND session.type = 'PUBLIC'
                        AND (:session_type = 'All' OR :session_type = 'Public')
                    )
                    THEN session.id
                END) AS public_sessions_conducted,
            
                -- PRIVATE sessions conducted
                COUNT(DISTINCT CASE
                    WHEN (
                        so.type = 'MENTOR'
                        AND session.started_at IS NOT NULL
                        AND session.type = 'PRIVATE'
                        AND (:session_type = 'All' OR :session_type = 'Private')
                    )
                    THEN session.id
                END) AS private_sessions_conducted
            
            FROM (
                SELECT
                    *
                FROM
                    public.sessions
                WHERE
                    (public.sessions.start_date > :start_date OR :start_date IS NULL)
                    AND (public.sessions.end_date < :end_date OR :end_date IS NULL)
            ) AS session
            JOIN
                public.session_ownerships AS so ON so.session_id = session.id
            WHERE
                (:userId IS NOT NULL AND so.user_id = :userId OR :userId IS NULL)
                AND session.deleted_at IS NULL
                 DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'mentoring_session_details',
				query: `SELECT
                session.title AS "sessions_title",
                ue.name AS "sessions_created_by",
                session.seats_limit-session.seats_remaining AS "number_of_mentees",
                TO_TIMESTAMP(session.start_date)::DATE AS "date_of_session",
                session.type AS "session_type",
                CASE WHEN session.started_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS "session_conducted",
                ROUND(EXTRACT(EPOCH FROM(TO_TIMESTAMP(session.end_date)-TO_TIMESTAMP(session.start_date)))/60) AS "duration_of_sessions_attended_in_minutes"
            FROM (SELECT * FROM public.sessions WHERE start_date > :start_date AND end_date < :end_date) AS session
            JOIN
                (SELECT * FROM public.session_ownerships WHERE user_id = :userId AND type = 'MENTOR') AS so ON session.id = so.session_id
            LEFT JOIN
                public.user_extensions AS ue ON session.created_by = ue.user_id
            WHERE
                (
                    CASE
                        WHEN :session_type = 'All' THEN session.type IN ('PUBLIC', 'PRIVATE')
                        WHEN :session_type = 'PUBLIC' THEN session.type = 'PUBLIC'
                        WHEN :session_type = 'PRIVATE' THEN session.type = 'PRIVATE'
                        ELSE TRUE
                    END
                )
                AND session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_hours_of_sessions_created_by_session_manager',
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
            
            FROM
                (SELECT * FROM public.sessions 
                 WHERE 
                    public.sessions.start_date > :start_date 
                   AND public.sessions.end_date < :end_date) AS Session
            JOIN
                (SELECT *
                 FROM public.session_ownerships 
                 WHERE public.session_ownerships.user_id = :userId 
                   AND public.session_ownerships.type = 'CREATOR') AS so 
            ON Session.id = so.session_id
            WHERE
                -- Simplified the CASE logic for filtering session types
                (
                    CASE 
                        WHEN :session_type = 'All' THEN TRUE
                        WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                        WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                        ELSE TRUE
                    END
                )
                AND Session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'total_number_of_hours_of_mentoring_conducted',
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
            
            FROM
                (SELECT * FROM public.sessions 
                 WHERE public.sessions.started_at IS NOT NULL
                   AND public.sessions.start_date > :start_date 
                   AND public.sessions.end_date < :end_date) AS Session
            JOIN
                (SELECT *
                 FROM public.session_ownerships 
                 WHERE public.session_ownerships.user_id = :userId 
                   AND public.session_ownerships.type = 'MENTOR') AS so 
            ON Session.id = so.session_id
            WHERE
                -- Simplified the CASE logic for filtering session types
                (
                    CASE 
                        WHEN :session_type = 'All' THEN TRUE
                        WHEN :session_type = 'PUBLIC' THEN Session.type = 'PUBLIC'
                        WHEN :session_type = 'PRIVATE' THEN Session.type = 'PRIVATE'
                        ELSE TRUE
                    END
                )
                AND Session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'split_of_sessions_created_and_conducted',
				query: `SELECT
                :start_date AS startDate,
                :end_date AS endDate,
                
                -- Count session_created
                COUNT(*) FILTER (
                    WHERE so.type = 'CREATOR'
                    AND (
                        :session_type = 'All'
                        OR (:session_type = 'Public' AND session.type = 'PUBLIC')
                        OR (:session_type = 'Private' AND session.type = 'PRIVATE')
                    )
                ) AS total_session_created,
                
                -- Total sessions conducted (all types combined)
                COUNT(*) FILTER (
                    WHERE so.type = 'MENTOR'
                    AND  session.started_at IS NOT NULL
                    AND (
                        :session_type = 'All'
                        OR :session_type = 'Public' AND session.type = 'PUBLIC'
                        OR :session_type = 'Private' AND session.type = 'PRIVATE'
                    )
                ) AS total_sessions_conducted,
                
                -- Public sessions conducted
                COUNT(*) FILTER (
                    WHERE so.type = 'MENTOR'
                    AND session.started_at IS NOT NULL
                    AND :session_type IN ('All', 'Public')
                    AND session.type = 'PUBLIC'
                ) AS public_sessions_conducted,
                
                -- Private sessions conducted
                COUNT(*) FILTER (
                    WHERE so.type = 'MENTOR'
                    AND session.started_at IS NOT NULL
                    AND :session_type IN ('All', 'Private')
                    AND session.type = 'PRIVATE'
                ) AS private_sessions_conducted,
                
                -- Public sessions created
                COUNT(*) FILTER (
                    WHERE so.type = 'CREATOR'
                    AND :session_type IN ('All', 'Public')
                    AND session.type = 'PUBLIC'
                ) AS public_sessions_created,
                
                -- Private sessions created
                COUNT(*) FILTER (
                    WHERE so.type = 'CREATOR'
                    AND :session_type IN ('All', 'Private')
                    AND session.type = 'PRIVATE'
                ) AS private_sessions_created
            
            FROM
                (SELECT * FROM public.sessions WHERE (public.sessions.start_date > :start_date OR :start_date IS NULL) AND (public.sessions.end_date < :end_date OR :end_date IS NULL)) AS session
            JOIN
                (SELECT *
                 FROM public.session_ownerships 
                 WHERE (:userId IS NOT NULL AND user_id = :userId OR :userId IS NULL)
                   AND type IN ('CREATOR', 'MENTOR')
                 ORDER BY public.session_ownerships.session_id, public.session_ownerships.user_id, public.session_ownerships.type -- Updated to match DISTINCT ON
                ) AS so 
                ON session.id = so.session_id
            WHERE
                (
                    :session_type = 'All'
                    OR :session_type = 'Public'
                    OR :session_type = 'Private'
                )
                AND session.deleted_at IS NULL
                DYNAMIC_AND_CLAUSE;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
			{
				report_code: 'session_manger_session_details',
				query: `WITH 
                session_count AS (
                SELECT session.mentor_id, session.mentor_name, COUNT(*) AS number_of_sessions,
                TO_CHAR( INTERVAL '1 second' * ROUND(SUM(EXTRACT(EPOCH FROM (session.completed_at - session.started_at)))),
                                'HH24:MI:SS'
                                ) AS "hours_of_mentoring_sessions"
                FROM public.sessions AS session WHERE deleted_at IS NULL AND session.created_by = :userId AND session.started_at IS NOT NULL AND session.completed_at IS NOT NULL AND session.start_date > :start_date AND session.end_date < :end_date AND (CASE
                                        WHEN :session_type = 'All' THEN session.type IN ('PUBLIC', 'PRIVATE')
                                        WHEN :session_type = 'Public' THEN session.type = 'PUBLIC'
                                        WHEN :session_type = 'Private' THEN session.type = 'PRIVATE'
                                        ELSE TRUE
                                    END
                                )
                GROUP BY session.mentor_id, session.mentor_name
            )
            SELECT sc.mentor_name as mentor_name , 
             sc.number_of_sessions as number_of_mentoring_sessions,
             sc.hours_of_mentoring_sessions as hours_of_mentoring_sessions,
             COALESCE(CAST(ue.rating ->>'average'AS NUMERIC),0) AS avg_mentor_rating
            FROM session_count AS sc
            JOIN public.user_extensions AS ue ON sc.mentor_id = ue.user_id
            DYNAMIC_WHERE_CLAUSE
            ORDER BY sc.mentor_name 
            ;`,
				organization_id: defaultOrgId,
				status: 'ACTIVE',
				created_at: Sequelize.literal('CURRENT_TIMESTAMP'),
				updated_at: Sequelize.literal('CURRENT_TIMESTAMP'),
			},
		])
	},

	async down(queryInterface, Sequelize) {
		// Revert the inserted data
		await queryInterface.bulkDelete('report_queries', { report_code: 'session_created' })
	},
}
