import { Box, Paper, Typography } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { ReactNode } from "react";

const listMinWidth = 640;

export const VirtualList = <T,>(props: {
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
  rowHeight?: number;
}) => {
  const rowHeight = props.rowHeight ?? 56;
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
  });
  if (props.items.length === 0) {
    return <Typography color="text.secondary">{props.empty}</Typography>;
  }
  return (
    <Paper variant="outlined">
      <Box ref={scroller} sx={{ maxHeight: 400, overflow: "auto" }}>
        <Box sx={{ height: virtualizer.getTotalSize(), minWidth: listMinWidth, position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => (
            <Box
              key={v.key}
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: rowHeight,
                transform: `translateY(${v.start}px)`,
                display: "flex",
                alignItems: "center",
                gap: 2,
                px: 2,
                borderBottom: 1,
                borderColor: "divider",
                boxSizing: "border-box",
              }}
            >
              {props.render(props.items[v.index])}
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
};
