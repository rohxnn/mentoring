'use strict'

exports.attendeeData = (attendeeInfo) => {
	let restructuredData = {
		attendee_id: attendeeInfo?.id ?? null,
		enrolled_type: attendeeInfo?.type ?? null,
		attendee_meeting_info: attendeeInfo?.meeting_info ?? null,
		joined_at: attendeeInfo?.joined_at ?? null,
		mentee_id: attendeeInfo?.mentee_id ?? null,
	}
	return restructuredData
}
