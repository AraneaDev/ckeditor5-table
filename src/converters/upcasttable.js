/**
 * @license Copyright (c) 2003-2018, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module table/converters/upcasttable
 */

import ModelRange from '@ckeditor/ckeditor5-engine/src/model/range';
import ModelPosition from '@ckeditor/ckeditor5-engine/src/model/position';
import { createEmptyTableCell } from '../commands/utils';

/**
 * View table element to model table element conversion helper.
 *
 * This conversion helper converts the table element as well as table rows.
 *
 * @returns {Function} Conversion helper.
 */
export default function upcastTable() {
	return dispatcher => {
		dispatcher.on( 'element:table', ( evt, data, conversionApi ) => {
			const viewTable = data.viewItem;

			// When element was already consumed then skip it.
			if ( !conversionApi.consumable.test( viewTable, { name: true } ) ) {
				return;
			}

			const { rows, headingRows, headingColumns } = scanTable( viewTable );

			// Only set attributes if values is greater then 0.
			const attributes = {};

			if ( headingColumns ) {
				attributes.headingColumns = headingColumns;
			}

			if ( headingRows ) {
				attributes.headingRows = headingRows;
			}

			const table = conversionApi.writer.createElement( 'table', attributes );

			// Insert element on allowed position.
			const splitResult = conversionApi.splitToAllowedParent( table, data.modelCursor );

			// When there is no split result it means that we can't insert element to model tree, so let's skip it.
			if ( !splitResult ) {
				return;
			}

			conversionApi.writer.insert( table, splitResult.position );
			conversionApi.consumable.consume( viewTable, { name: true } );

			if ( rows.length ) {
				// Upcast table rows in proper order (heading rows first).
				rows.forEach( row => conversionApi.convertItem( row, ModelPosition.createAt( table, 'end' ) ) );
			} else {
				// Create one row and one table cell for empty table.
				const row = conversionApi.writer.createElement( 'tableRow' );
				conversionApi.writer.insert( row, ModelPosition.createAt( table, 'end' ) );

				createEmptyTableCell( conversionApi.writer, ModelPosition.createAt( row, 'end' ) );
			}

			// Set conversion result range.
			data.modelRange = new ModelRange(
				// Range should start before inserted element
				ModelPosition.createBefore( table ),
				// Should end after but we need to take into consideration that children could split our
				// element, so we need to move range after parent of the last converted child.
				// before: <allowed>[]</allowed>
				// after: <allowed>[<converted><child></child></converted><child></child><converted>]</converted></allowed>
				ModelPosition.createAfter( table )
			);

			// Now we need to check where the modelCursor should be.
			// If we had to split parent to insert our element then we want to continue conversion inside split parent.
			//
			// before: <allowed><notAllowed>[]</notAllowed></allowed>
			// after:  <allowed><notAllowed></notAllowed><converted></converted><notAllowed>[]</notAllowed></allowed>
			if ( splitResult.cursorParent ) {
				data.modelCursor = ModelPosition.createAt( splitResult.cursorParent );

				// Otherwise just continue after inserted element.
			} else {
				data.modelCursor = data.modelRange.end;
			}
		} );
	};
}

export function upcastTableCell( elementName ) {
	return dispatcher => {
		dispatcher.on( `element:${ elementName }`, ( evt, data, conversionApi ) => {
			const viewTableCell = data.viewItem;

			// When element was already consumed then skip it.
			if ( !conversionApi.consumable.test( viewTableCell, { name: true } ) ) {
				return;
			}

			const tableCell = conversionApi.writer.createElement( 'tableCell' );

			// Insert element on allowed position.
			const splitResult = conversionApi.splitToAllowedParent( tableCell, data.modelCursor );

			// When there is no split result it means that we can't insert element to model tree, so let's skip it.
			if ( !splitResult ) {
				return;
			}

			conversionApi.writer.insert( tableCell, splitResult.position );
			conversionApi.consumable.consume( viewTableCell, { name: true } );

			const modelCursor = ModelPosition.createAt( tableCell );
			conversionApi.convertChildren( viewTableCell, modelCursor );

			// Ensure a paragraph in the model for empty table cells.
			if ( !tableCell.childCount ) {
				conversionApi.writer.insertElement( 'paragraph', modelCursor );
			}

			// Set conversion result range.
			data.modelRange = new ModelRange(
				// Range should start before inserted element
				ModelPosition.createBefore( tableCell ),
				// Should end after but we need to take into consideration that children could split our
				// element, so we need to move range after parent of the last converted child.
				// before: <allowed>[]</allowed>
				// after: <allowed>[<converted><child></child></converted><child></child><converted>]</converted></allowed>
				ModelPosition.createAfter( tableCell )
			);

			// Continue after inserted element.
			data.modelCursor = data.modelRange.end;
		} );
	};
}

// Scans table rows and extracts required metadata from the table:
//
// headingRows    - the number of rows that goes as table header.
// headingColumns - max number of row headings.
// rows           - sorted `<tr>`s as they should go into the model - ie. if `<thead>` is inserted after `<tbody>` in the view.
//
// @param {module:engine/view/element~Element} viewTable
// @returns {{headingRows, headingColumns, rows}}
function scanTable( viewTable ) {
	const tableMeta = {
		headingRows: 0,
		headingColumns: 0
	};

	// The `<tbody>` and <thead> sections in the DOM do not have to be in order `<thead>` -> `<tbody>` and there might be more then one of
	// them.
	// As the model does not have those sections, rows from different sections must be sorted.
	// For example, below is a valid HTML table:
	//
	//		<table>
	//			<tbody><tr><td>2</td></tr></tbody>
	//			<thead><tr><td>1</td></tr></thead>
	//			<tbody><tr><td>3</td></tr></tbody>
	//		</table>
	//
	// But browsers will render rows in order as: 1 as heading and 2 and 3 as (body).
	const headRows = [];
	const bodyRows = [];

	// Currently the editor does not support more then one <thead> section.
	// Only the first <thead> from the view will be used as heading rows and others will be converted to body rows.
	let firstTheadElement;

	for ( const tableChild of Array.from( viewTable.getChildren() ) ) {
		// Only <thead>, <tbody> & <tfoot> from allowed table children can have <tr>s.
		// The else is for future purposes (mainly <caption>).
		if ( tableChild.name === 'tbody' || tableChild.name === 'thead' || tableChild.name === 'tfoot' ) {
			// Save the first <thead> in the table as table header - all other ones will be converted to table body rows.
			if ( tableChild.name === 'thead' && !firstTheadElement ) {
				firstTheadElement = tableChild;
			}

			for ( const tr of Array.from( tableChild.getChildren() ) ) {
				// This <tr> is a child of a first <thead> element.
				if ( tr.parent.name === 'thead' && tr.parent === firstTheadElement ) {
					tableMeta.headingRows++;
					headRows.push( tr );
				} else {
					bodyRows.push( tr );
					// For other rows check how many column headings this row has.

					const headingCols = scanRowForHeadingColumns( tr, tableMeta, firstTheadElement );

					if ( headingCols > tableMeta.headingColumns ) {
						tableMeta.headingColumns = headingCols;
					}
				}
			}
		}
	}

	tableMeta.rows = [ ...headRows, ...bodyRows ];

	return tableMeta;
}

// Scans `<tr>` and its children for metadata:
// - For heading row:
//     - either adds this row to heading or body rows.
//     - updates number of heading rows.
// - For body rows:
//     - calculates the number of column headings.
//
// @param {module:engine/view/element~Element} tr
// @returns {Number}
function scanRowForHeadingColumns( tr ) {
	let headingColumns = 0;
	let index = 0;

	// Filter out empty text nodes from tr children.
	const children = Array.from( tr.getChildren() )
		.filter( child => child.name === 'th' || child.name === 'td' );

	// Count starting adjacent <th> elements of a <tr>.
	while ( index < children.length && children[ index ].name === 'th' ) {
		const th = children[ index ];

		// Adjust columns calculation by the number of spanned columns.
		const colspan = parseInt( th.getAttribute( 'colspan' ) || 1 );

		headingColumns = headingColumns + colspan;
		index++;
	}

	return headingColumns;
}
