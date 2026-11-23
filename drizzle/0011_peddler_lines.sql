CREATE TABLE "peddler_lines" (
	"code" text PRIMARY KEY NOT NULL,
	"floor_no" smallint NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "peddler_lines_kind_check" CHECK ("peddler_lines"."kind" in ('greeting', 'rare'))
);
