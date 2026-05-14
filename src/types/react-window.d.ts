declare module 'react-window' {
  import { Component, CSSProperties, ReactNode, Ref } from 'react';

  interface ListChildComponentProps {
    index: number;
    style: CSSProperties;
  }

  interface ListProps {
    children: (props: ListChildComponentProps) => ReactNode;
    className?: string;
    defaultHeight?: number;
    listRef?: Ref<List>;
    onResize?: (height: number) => void;
    onRowsRendered?: (startIndex: number, stopIndex: number) => void;
    overscanCount?: number;
    rowComponent?: string | Component<Record<string, unknown>>;
    rowCount: number;
    rowHeight: number | ((index: number) => number);
    rowProps?: Record<string, unknown>;
    listStyle?: CSSProperties;
    tagName?: string;
  }

  export class List extends Component<ListProps> {
    scrollTo(offset: number): void;
    scrollToItem(index: number, align?: 'auto' | 'smart' | 'center' | 'end' | 'start'): void;
  }

  interface GridChildComponentProps {
    columnIndex: number;
    rowIndex: number;
    style: CSSProperties;
  }

  interface GridProps {
    children: (props: GridChildComponentProps) => ReactNode;
    className?: string;
    columnCount: number;
    columnWidth: number | ((index: number) => number);
    defaultHeight?: number;
    defaultWidth?: number;
    gridRef?: Ref<Grid>;
    onResize?: (height: number, width: number) => void;
    onCellsRendered?: (info: {
      overscanColumnStartIndex: number;
      overscanColumnStopIndex: number;
      overscanRowStartIndex: number;
      overscanRowStopIndex: number;
      visibleColumnStartIndex: number;
      visibleColumnStopIndex: number;
      visibleRowStartIndex: number;
      visibleRowStopIndex: number;
    }) => void;
    overscanCount?: number;
    rowComponent?: string | Component<Record<string, unknown>>;
    rowCount: number;
    rowHeight: number | ((index: number) => number);
    rowProps?: Record<string, unknown>;
    gridStyle?: CSSProperties;
    tagName?: string;
  }

  export class Grid extends Component<GridProps> {
    scrollTo({ scrollTop, scrollLeft }: { scrollTop?: number; scrollLeft?: number }): void;
    scrollToCell({
      columnIndex,
      rowIndex,
      align,
    }: {
      columnIndex?: number;
      rowIndex?: number;
      align?: 'auto' | 'smart' | 'center' | 'end' | 'start';
    }): void;
  }

  export function getScrollbarSize(): number;
}
